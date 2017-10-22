const functions = require('firebase-functions');
const slugify = require('slugify');
const request = require("request");

exports.createTutorialSlug = functions.database
  .ref('/tutorials/{tutorialKey}')
  .onCreate(event => {
    //Generate slug when a new tutorial is added
    let titleAndEpisode = event.data.val().title;
    let title = titleAndEpisode.split(" | ")[0];
    let episodeNumber = ('0' + titleAndEpisode.split("#")[1]).slice(-2);

    let slug = slugify(episodeNumber + "-" + title, {lower: true});
    return event.data.ref.update({slug: slug});
  });

exports.handleSubscription = functions.database
  .ref('/users/{userKey}/subscribed')
  .onUpdate(event => {
    let subscribed = event.data.val();
    let userToken = event.data.ref.parent.child('token');
    console.log("userToken", userToken);
    let requestUrl;

    if (subscribed) {
      requestUrl = "https://iid.googleapis.com/iid/v1:batchAdd";
    } else {
      requestUrl = "https://iid.googleapis.com/iid/v1:batchRemove";
    }

    var options = {
      method: 'POST',
      url: requestUrl,
      headers: {
        'content-type': 'application/json',
        authorization: 'key=AAAAtNIEDkk:APA91bFpY2GxbM1gyStOUD4E3Dll_L4INgDolt7QkKleCNQzDbWNFj2oreTX9nJMzLPlsBXog3EimR_xudvCymx1zMB2xDEEo1FkQPSXO74Vrl8GvMB2Mafd0NapkFFW87VwkY_1zAxh'
      },
      body: {
        to: '/topics/all',
        registration_tokens: [userToken]
      },
      json: true
    };
    request(options, function (error, response, body) {
      if (error) throw new Error(error);

      console.log("body", body);
    });
  });
