const functions = require('firebase-functions');
const slugify = require('slugify');
const request = require("request");
const admin = require('firebase-admin');
const cors = require('cors')({ origin: true });
const rp = require('request-promise');
const nodemailer = require('nodemailer');

admin.initializeApp(functions.config().firebase);

const gmailEmail = functions.config().gmail.email;
const gmailPassword = functions.config().gmail.password;
const mailTransport = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: gmailEmail,
    pass: gmailPassword
  }
});

exports.addTutorial = functions.database
  .ref('/tutorials/series/{seriesName}/videos/{tutorialKey}')
  .onCreate(event => {
    let tutorialInfo = event.data.val();
    let titleAndEpisode = tutorialInfo.title;

    tutorialInfo.title = titleAndEpisode.split(" | ")[0];
    tutorialInfo.episodeNumber = ('0' + titleAndEpisode.split("#")[1]).slice(-2);
    tutorialInfo.slug = slugify(tutorialInfo.episodeNumber + "-" + tutorialInfo.title, {lower: true});
    tutorialInfo.shortDescription = tutorialInfo.description.split(".")[0] + ".";

    let tutorialsCountRef = admin.database().ref('tutorials/counter');
    tutorialsCountRef.transaction(tutorialsCount => {
      return tutorialsCount + 1;
    });

    //Updates the information of the new tutorial in /tutorials
    return event.data.ref.update(tutorialInfo).then(() => {
      //After that, it takes the oldest tutorial in home/latestTutorials and replaces it with the new one
      const root = event.data.ref.root;
      return root.child('home/latestTutorials')
        .orderByChild("publishedDate")
        .limitToFirst(1)
        .once('child_added', (snapshot) => {
          return snapshot.ref.update(tutorialInfo);
        });
    });
  });

exports.handleSubscription = functions.database
  .ref('/users/list/{uid}/subscribed')
  .onWrite(event => {
    const uid = event.params.uid;

    // If we are deleting the user stop doing stuff
    if (!event.data.exists()) {
      console.log(`User: ${uid} was removed`);
      return;
    }

    const subscribed = event.data.val();

    const root = event.data.ref.root;
    root.child(`/users/list/${uid}/token`)
      .once('value').then(snap => {
        const userToken = snap.val();

        let userCountRef = admin.database().ref('users/subscriptions');

        let requestUrl;
        if (subscribed) {
          requestUrl = "https://iid.googleapis.com/iid/v1:batchAdd";

          userCountRef.transaction(userCount => {
            return userCount + 1;
          });
        } else {
          requestUrl = "https://iid.googleapis.com/iid/v1:batchRemove";

          userCountRef.transaction(userCount => {
            return userCount - 1;
          });
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
        request(options, function(error, response, body) {
          if (error) throw new Error(error);
          console.log("User: " + uid, "Subscribed: " + subscribed);
        });
      });
  });

exports.handleFormSubmit = functions.https.onRequest((req, res) => {

  console.log("New email", req.body);

  let name = req.body.name;
  let email = req.body.email;
  let subject = req.body.subject;
  let message = req.body.message;
  let recaptcha_token = req.body.recaptcha_token;

  //Add CORS middleware
  cors(req, res, () => {
    //Add request-promise to check recaptcha validation
    rp({
      uri: 'https://recaptcha.google.com/recaptcha/api/siteverify',
      method: 'POST',
      formData: {
        secret: '6Lf6xzsUAAAAALKwXNboJqVkL9MncNm4-0p6y0Oh',
        response: recaptcha_token
      },
      json: true
    }).then(result => {
      if (result.success) {

        //Send email
        const mailOptions = {
          from: `${name} <${email}>`,
          to: gmailEmail
        };
        mailOptions.subject = subject;
        mailOptions.text = message;
        mailTransport.sendMail(mailOptions);

        res.status(200).json({ message: "valid-token" });
      } else {
        res.status(400).json({ message: "wrong-token" })
      }
    }).catch(reason => {
      res.status(400).json({ message: "error", error: reason })
    })
  });
});
