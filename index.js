/**
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

// [START imports]
var firebase = require('firebase-admin');
// [END imports]
var nodemailer = require('nodemailer');
var schedule = require('node-schedule');
var Promise = require('promise');
var escape = require('escape-html');

// TODO(DEVELOPER): Configure your email transport.
// Configure the email transport using the default SMTP transport and a GMail account.
// See: https://nodemailer.com/
// For other types of transports (Amazon SES, Sendgrid...) see https://nodemailer.com/2-0-0-beta/setup-transporter/
var mailTransport = nodemailer.createTransport('smtps://<user>%40gmail.com:<password>@smtp.gmail.com');

// TODO(DEVELOPER): Change the two placeholders below.
// [START initialize]
// Initialize the app with a service account, granting admin privileges
var serviceAccount = require("./key/servisim-4f449-firebase-adminsdk-njosi-8d84654e23.json");

firebase.initializeApp({
  credential: firebase.credential.cert(serviceAccount),
  databaseURL: 'https://servisim-4f449.firebaseio.com/'
});
// [END initialize]

/**
 * Send a new star notification email to the user with the given UID.
 */
// [START single_value_read]
function sendNotificationToUser(uid, postId) {
  // Fetch the user's email.
  var userRef = firebase.database().ref('/users/' + uid);
  userRef.once('value').then(function(snapshot) {
    var email = snapshot.val().email;
    // Send the email to the user.
    // [START_EXCLUDE]
    if (email) {
      sendNotificationEmail(email).then(function() {
        // Save the date at which we sent that notification.
        // [START write_fan_out]
        var update = {};
        update['/posts/' + postId + '/lastNotificationTimestamp'] =
            firebase.database.ServerValue.TIMESTAMP;
        update['/user-posts/' + uid + '/' + postId + '/lastNotificationTimestamp'] =
            firebase.database.ServerValue.TIMESTAMP;
        firebase.database().ref().update(update);
        // [END write_fan_out]
      });
    }
    // [END_EXCLUDE]
  }).catch(function(error) {
    console.log('Failed to send notification to user:', error);
  });
}
// [END single_value_read]


/**
 * Send the new star notification email to the given email.
 */
function sendNotificationEmail(email) {
  var mailOptions = {
    from: '"Firebase Database Quickstart" <noreply@firebase.com>',
    to: email,
    subject: 'New star!',
    text: 'One of your posts has received a new star!'
  };
  return mailTransport.sendMail(mailOptions).then(function() {
    console.log('New star email notification sent to: ' + email);
  });
}

/**
 * Update the star count.
 */
// [START post_stars_transaction]
function updateStarCount(postRef) {
  postRef.transaction(function(post) {
    if (post) {
      post.starCount = post.stars ? Object.keys(post.stars).length : 0;
    }
    return post;
  });
}
// [END post_stars_transaction]

/**
 * Keep the likes count updated and send email notifications for new likes.
 */
function startListeners() {
  firebase.database().ref('/posts').on('child_added', function(postSnapshot) {
    var postReference = postSnapshot.ref;
    var uid = postSnapshot.val().uid;
    var postId = postSnapshot.key;
    // Update the star count.
    // [START post_value_event_listener]
    postReference.child('stars').on('value', function(dataSnapshot) {
      updateStarCount(postReference);
      // [START_EXCLUDE]
      updateStarCount(firebase.database().ref('user-posts/' + uid + '/' + postId));
      // [END_EXCLUDE]
    }, function(error) {
      console.log('Failed to add "value" listener at /posts/' + postId + '/stars node:', error);
    });
    // [END post_value_event_listener]
    // Send email to author when a new star is received.
    // [START child_event_listener_recycler]
    postReference.child('stars').on('child_added', function(dataSnapshot) {
      sendNotificationToUser(uid, postId);
    }, function(error) {
      console.log('Failed to add "child_added" listener at /posts/' + postId + '/stars node:', error);
    });
    // [END child_event_listener_recycler]
  });
  console.log('New star notifier started...');
  console.log('Likes count updater started...');
}
/**
 * Send an email listing the top posts every Sunday.
 */
function startWeeklyTopPostEmailer() {
  // Run this job every Sunday at 2:30pm.
  schedule.scheduleJob({hour: 14, minute: 30, dayOfWeek: 0}, function () {
    // List the top 5 posts.
    // [START top_posts_query]
    var topPostsRef = firebase.database().ref('/posts').orderByChild('starCount').limitToLast(5);
    // [END top_posts_query]
    var allUserRef = firebase.database().ref('/users');
    Promise.all([topPostsRef.once('value'), allUserRef.once('value')]).then(function(resp) {
      var topPosts = resp[0].val();
      var allUsers = resp[1].val();
      var emailText = createWeeklyTopPostsEmailHtml(topPosts);
      sendWeeklyTopPostEmail(allUsers, emailText);
    }).catch(function(error) {
      console.log('Failed to start weekly top posts emailer:', error);
    });
  });
  console.log('Weekly top posts emailer started...');
}

/**
 * Sends the weekly top post email to all users in the given `users` object.
 */
function sendWeeklyTopPostEmail(users, emailHtml) {
  Object.keys(users).forEach(function(uid) {
    var user = users[uid];
    if (user.email) {
      var mailOptions = {
        from: '"Firebase Database Quickstart" <noreply@firebase.com>',
        to: user.email,
        subject: 'This week\'s top posts!',
        html: emailHtml
      };
      mailTransport.sendMail(mailOptions).then(function() {
        console.log('Weekly top posts email sent to: ' + user.email);
        // Save the date at which we sent the weekly email.
        // [START basic_write]
        return firebase.database().child('/users/' + uid + '/lastSentWeeklyTimestamp')
            .set(firebase.database.ServerValue.TIMESTAMP);
        // [END basic_write]
      }).catch(function(error) {
        console.log('Failed to send weekly top posts email:', error);
      });
    }
  });
}

/**
 * Creates the text for the weekly top posts email given an Object of top posts.
 */
function createWeeklyTopPostsEmailHtml(topPosts) {
  var emailHtml = '<h1>Here are this week\'s top posts:</h1>';
  Object.keys(topPosts).forEach(function(postId) {
    var post = topPosts[postId];
    emailHtml += '<h2>' + escape(post.title) + '</h2><div>Author: ' + escape(post.author) +
        '</div><div>Stars: ' + escape(post.starCount) + '</div><p>' + escape(post.body) + '</p>';
  });
  return emailHtml;
}










function startNewChildListeners() {
  console.log('startNewChildListeners table watcher started...');

  firebase.database().ref('/phone-status').on('child_added', function(postSnapshot) {
    var postReference = postSnapshot.ref;
    var phone = postSnapshot.key;
    var verificationSmsSendToDevice = postSnapshot.val().verificationSmsSendToDevice;

    if(verificationSmsSendToDevice != 'undefined' && !verificationSmsSendToDevice)
    {
      senSMS(phone);
    }
    else
    {
      console.log('dont send sms');  
    }  
  });
}


function senSMS(phone) {
  console.log('start send sms');  
  var request = require('request');
  // Set the headers
  var headers = {
      'api_key': 'f9192ae6-2d3b-42e8-bafd-9cc732f44f98'
  }
  // Configure the request
  var options = {
      url: 'https://api-gw.turkcell.com.tr/api/v1/sms',
      method: 'POST',
      headers: headers,
      form: {'from' : '5332108236', 'to':phone.substring(1),'content':'1234'}
  }

  firebase.database().ref('phone-sms/' + phone +'/sms').set(1234);
  firebase.database().ref('phone-status/' + phone +'/verificationSmsSendToDevice').set(true);
  
  // Start the request
  /*request(options, function (error, response, body) {
      console.log('sms response arrived');  
      if (!error && response.statusCode == 201) {
          firebase.database().ref('phone-sms/' + phone +'/sms').set(1234);
          firebase.database().ref('phone-status/' + phone +'/verificationSmsSendToDevice').set(true);
          console.log(body)
      }
      else{
        firebase.database().ref('phone-status/' + phone +'/verificationSmsSendToDevice').set(false);
        console.log('sms response error : ' + error + '  ' + response.statusCode);  
      }
  })*/
}


function startCreateCustomToken() {
  console.log('startCreateCustomToken table watcher started...');

  firebase.database().ref('/custom-token-status').on('child_added', function(postSnapshot) {
    var postReference = postSnapshot.ref;
    var phone = postSnapshot.key;
    var sms = postSnapshot.val().userSms;
    
    if(sms === undefined){
      console.log('sms not found customTokenSend undefined');   
      return;
    }

    if(sms === '' ){
      console.log('sms empty dont create custom token'); 
      return;
    }

    console.log('sms : ' + sms); 

    firebase.database().ref('/phone-sms/'+phone).on('value', function(snapshot) {
      var serverSms = snapshot.val().sms;
      
      var additionalClaims = {
        premiumAccount: true
      };

      if(sms == serverSms){
          firebase.auth().createCustomToken(phone,additionalClaims).then(function(customToken) {
            firebase.database().ref('custom-token-status/' + phone +'/customToken').set(customToken);
          }).catch(function(error) {
            console.log("Error creating custom token:", error);
          });  
        }else{
          console.log('sms different undefined');   
        }  
    });
 
  });

}

function createAdminUser() {
  firebase.database().ref('admins/OUPxTFceJ0OHx9YL8qwUWOl1dkn1/name').set("Caner");
  firebase.database().ref('admins/hqvhr7S9fybzx9qSPOYcbkmgFXn1/name').set("Talha");
}



var restify = require('restify');

function respond(req, res, next) {
  res.send('hello ' + req.params.name);
  next();
}

var server = restify.createServer();
server.get('/hello/:name', respond);
server.head('/hello/:name', respond);

server.listen(8080, function() {
  console.log('%s listening at %s', server.name, server.url);
});



// Start the server.
//createAdminUser();
startNewChildListeners();
startCreateCustomToken();
//startWeeklyTopPostEmailer();