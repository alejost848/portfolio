const functions = require('firebase-functions');
const slugify = require('slugify');
const request = require("request");
const admin = require('firebase-admin');

//Send email
const fs = require('fs');
const cors = require('cors')({ origin: true });
const rp = require('request-promise');
const nodemailer = require('nodemailer');
const handlebars = require('handlebars');

//Firebase storage
const gcs = require('@google-cloud/storage')({keyFilename: 'service-account-credentials.json'});

const spawn = require('child-process-promise').spawn;
const path = require('path');
const os = require('os');

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
  .ref('/tutorials/{seriesName}/videos/{tutorialKey}')
  .onCreate(event => {
    let tutorialInfo = event.data.val();
    let titleAndEpisode = tutorialInfo.title;

    tutorialInfo.title = titleAndEpisode.split(" | ")[0];
    tutorialInfo.episodeNumber = ('0' + titleAndEpisode.split("#")[1]).slice(-2);
    tutorialInfo.slug = slugify(tutorialInfo.episodeNumber + "-" + tutorialInfo.title, {lower: true});
    tutorialInfo.shortDescription = tutorialInfo.description.split(".")[0] + ".";
    //Add seriesSlug to every tutorial saved to fix latestTutorials need for hard-coding "after-effects"
    tutorialInfo.seriesSlug = event.params.seriesName;

    //Update the information of the new tutorial in /tutorials
    return event.data.ref.update(tutorialInfo)
    .then(() => {
      //After that, it takes the oldest tutorial in home/latestTutorials and replaces it with the new one
      const root = event.data.ref.root;
      return root.child('home/latestTutorials')
        .orderByChild("publishedDate")
        .limitToFirst(1)
        .once('child_added', (snapshot) => {
          return snapshot.ref.update(tutorialInfo);
        });
    }).then(() => {
      //Add +1 to the tutorial count
      let tutorialsCountRef = admin.database().ref('dashboard/overview/tutorialCount');
      return tutorialsCountRef.transaction(tutorialsCount => {
        return tutorialsCount + 1;
      }).then(() => {
        return null;
      });
    });
  });

  exports.addWork = functions.database
    .ref('/works/{workSlug}')
    .onWrite(event => {
      // Exit when the work is deleted
      if (!event.data.exists()) {
        console.log(`Work "${event.params.workSlug}" deleted.`);
        return null;
      }

      let work = event.data.val();

      //On edit or on create
      //Add new stuff from the paper-chips to the database for autocompleteSuggestions
      return admin.database().ref('dashboard/autocompleteSuggestions').update(getUpdatedObject(work));
    });

function getUpdatedObject(work) {
  // HACK: Multi-path updates
  var updateObject = {};
  let items = ["categories", "clients", "credits", "toolsUsed"];
  for (var i = 0; i < items.length; i++) {
    let item = items[i];
    for (var key in work[item]) {
      if (work[item].hasOwnProperty(key)) {
        updateObject[`${item}/${key}`] = work[item][key];
      }
    }
  }
  return updateObject;
}

exports.createThumbnailFromVideoId = functions.database
  .ref('/works/{workSlug}/videoId')
  .onWrite(event => {
    // Exit when removing videoId
    if (!event.data.exists()) {
      return null;
    }

    let workSlug = event.params.workSlug;
    let videoId = event.data.val();

    //Creation or edition event
    let thumbnail = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    return admin.database().ref(`works/${workSlug}`).update( { thumbnail: thumbnail } );
  });

exports.handleSubscription = functions.database
  .ref('/users/{uid}/subscribed')
  .onWrite(event => {
    const uid = event.params.uid;

    // If we are deleting the user stop doing stuff
    if (!event.data.exists()) {
      console.log(`User: ${uid} was removed`);
      return null;
    }

    const subscribed = event.data.val();

    const root = event.data.ref.root;
    root.child(`/users/${uid}/token`)
      .once('value').then(snap => {
        const userToken = snap.val();

        let userCountRef = admin.database().ref('dashboard/overview/subscriptions');

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

        //Read email template, replace variables with handlebars and send the email
        fs.readFile(__dirname + '/email.html', 'utf8', (err, data) => {
          if (err) {
            throw err;
          }

          var template = handlebars.compile(data);
          var replacements = {
            name: name,
            email: email,
            subject: subject,
            message: message
          };
          var htmlToSend = template(replacements);

          var mailOptions = {
            from: email,
            to: gmailEmail,
            subject: "New form submission in alejo.st",
            html: htmlToSend
          };
          mailTransport.sendMail(mailOptions).then(() => {
            console.log("New form submission", req.body);
          });
        });

        res.status(200).json({ message: "valid-token" });
      } else {
        res.status(400).json({ message: "wrong-token" })
      }
    }).catch(reason => {
      res.status(400).json({ message: "error", error: reason })
    })
  });
});

exports.generateThumbnail = functions.storage.object().onChange(event => {
  const object = event.data; // The Storage object.

  const fileBucket = object.bucket; // The Storage bucket that contains the file.
  const filePath = object.name; // File path in the bucket.
  const contentType = object.contentType; // File content type.
  const resourceState = object.resourceState; // The resourceState is 'exists' or 'not_exists' (for file/folder deletions).

  // Exit if this is triggered on a file that is not an image.
  if (!contentType.startsWith('image/')) {
    console.log('This is not an image.');
    return null;
  }

  // Get the directory name.
  const directoryName = path.dirname(filePath);
  let workPath;
  // Exit if the image is not a cover.
  if (!directoryName.endsWith('/cover')) {
    console.log('Thumbnail not needed for other images.');
    return null;
  } else {
    //Get the work path if the image is a cover
    workPath = directoryName.slice(0, -6);
  }

  // Get the file name.
  const fileName = path.basename(filePath);
  // Exit if the image is already a thumbnail.
  if (fileName.startsWith('thumb_')) {
    console.log('Thumbnail already created.');
    return null;
  }

  // If cover is deleted, remove thumbnail too
  if (resourceState === 'not_exists') {
    const bucket = gcs.bucket(fileBucket);
    return bucket.deleteFiles({ prefix: directoryName })
    .then(() => {
      //Remove coverImage and thumbnail from database
      return admin.database().ref(workPath).update({ coverImage: null, thumbnail: null });
    }).then(() => {
      console.log('Thumbnail deleted.');
    });
  }

  // Download file from bucket.
  const bucket = gcs.bucket(fileBucket);
  const tempFilePath = path.join(os.tmpdir(), fileName);
  const metadata = { contentType: contentType };
  // We add a 'thumb_' prefix to thumbnails file name. That's where we'll upload the thumbnail.
  const thumbFileName = `thumb_${fileName}`;
  const thumbFilePath = path.join(path.dirname(filePath), thumbFileName);

  return bucket.file(filePath).download({
    destination: tempFilePath
  }).then(() => {
    console.log('Image downloaded locally to', tempFilePath);
    // Generate a thumbnail using ImageMagick.
    return spawn('convert', [tempFilePath, '-thumbnail', '320x180>', tempFilePath]);
  }).then(() => {
    console.log('Thumbnail created at', tempFilePath);
    // Uploading the thumbnail.
    return bucket.upload(tempFilePath, { destination: thumbFilePath, metadata: metadata });
  }).then(() => {
    console.log('Thumbnail uploaded to bucket.');
    // Once the thumbnail has been uploaded delete the local file to free up disk space.
    fs.unlinkSync(tempFilePath);

    // Get the Signed URLs for the thumbnail and original image.
    const config = {
      action: 'read',
      expires: '03-01-2500'
    };
    return bucket.file(thumbFilePath).getSignedUrl(config);
  }).then((signedUrls) => {
    console.log('Download URL generated.', signedUrls[0]);
    // Upload the information to the database
    return admin.database().ref(workPath).update({ thumbnail: signedUrls[0], videoId: null });
  }).then(() => console.log('Thumbnail saved to the database.'));
});
