const functions = require('firebase-functions');
const slugify = require('slugify');
const admin = require('firebase-admin');

//Send email
const fs = require('fs');
const cors = require('cors')({ origin: true });
const requestPromise = require('request-promise');
const nodemailer = require('nodemailer');
const handlebars = require('handlebars');

//Firebase storage
const gcs = require('@google-cloud/storage')({keyFilename: 'service-account-credentials.json'});

const spawn = require('child-process-promise').spawn;
const path = require('path');
const os = require('os');
const mkdirp = require('mkdirp-promise');

admin.initializeApp();

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
  .onCreate((snap, context) => {
    let tutorialInfo = snap.val();
    let titleAndEpisode = tutorialInfo.title;

    tutorialInfo.title = titleAndEpisode.split(" | ")[0];
    tutorialInfo.episodeNumber = ('0' + titleAndEpisode.split("#")[1]).slice(-2);
    tutorialInfo.slug = slugify(tutorialInfo.episodeNumber + "-" + tutorialInfo.title, {lower: true});
    tutorialInfo.shortDescription = tutorialInfo.description.split(".")[0] + ".";
    tutorialInfo.seriesSlug = event.params.seriesName;

    //Update the information of the new tutorial in /tutorials
    return snap.ref.update(tutorialInfo)
    .then(() => {
      console.log(`Tutorial "${tutorialInfo.title}" was created`);
      //After that, it takes the oldest tutorial in home/latestTutorials and replaces it with the new one
      const root = snap.ref.root;
      return root.child('home/latestTutorials')
        .orderByChild("publishedDate")
        .limitToFirst(1)
        .once('child_added', (snapshot) => {
          return snapshot.ref.update(tutorialInfo);
        });
    }).then(() => {
      console.log(`Tutorial "${tutorialInfo.title}" was added to latestTutorials`);

      //Add 1 to tutorialCount
      const tutorialCountPromise = admin.database().ref('dashboard/overview/tutorialCount').transaction(number => {
        return number + 1;
      });

      //Add notification
      const notification = {
        title: `New tutorial: ${tutorialInfo.title}`,
        body: tutorialInfo.shortDescription,
        icon: "/images/manifest/icon-72x72.png",
        click_action: `https://alejo.st/tutorial/${tutorialInfo.seriesSlug}/${tutorialInfo.slug}`,
        publishedDate: admin.database.ServerValue.TIMESTAMP
      };
      const notificationPromise = admin.database().ref('dashboard/notifications').push(notification);

      return Promise.all([tutorialCountPromise, notificationPromise]).then(function(values) {
        console.log(`Notification added for "${tutorialInfo.title}".`);
      });
    });
  });

exports.addWork = functions.database
  .ref('/works/{workSlug}')
  .onWrite((change, context) => {
    const workSlug = context.params.workSlug;

    // On delete
    if (!change.after.exists()) {
      // Remove contents of storage folder to save space
      const bucket = gcs.bucket("alejost848-afea9.appspot.com");
      return bucket.deleteFiles({ prefix: `works/${workSlug}` })
        .then(() => {
          console.log(`Work "${workSlug}" deleted.`);
          //Remove 1 from workCount
          return admin.database().ref('dashboard/overview/workCount').transaction(number => {
            return number - 1;
          });
        });
    }

    // On create
    if (!change.before.exists()) {
      //Add new stuff from the paper-chips to the database for autocompleteSuggestions
      const work = change.after.val();
      const autocompletePromise = admin.database().ref('dashboard/autocompleteSuggestions').update(getUpdatedObject(work));
      //Add 1 to workCount
      const workCountPromise = admin.database().ref('dashboard/overview/workCount').transaction(number => {
        return number + 1;
      });

      // Compress cover and generate thumbnail
      const coverImagePromise = handleCoverImage(workSlug, work);

      //Add notification
      const notification = {
        title: `New work: ${work.title}`,
        body: work.shortDescription,
        icon: "/images/manifest/icon-72x72.png",
  	    click_action: `https://alejo.st/work/${workSlug}`,
        publishedDate: admin.database.ServerValue.TIMESTAMP
      };
      const notificationPromise = admin.database().ref('dashboard/notifications').push(notification);

      return Promise.all([autocompletePromise, workCountPromise, notificationPromise, coverImagePromise]).then(function(values) {
        console.log(`"${workSlug}" processing completed.`);
      });
    }

    //On edit
    if (change.before.exists()) {
      //Add new stuff from the paper-chips to the database for autocompleteSuggestions
      const work = change.after.val();
      const autocompletePromise = admin.database().ref('dashboard/autocompleteSuggestions').update(getUpdatedObject(work));

      // Compress cover and generate thumbnail
      const coverImagePromise = handleCoverImage(workSlug, work);

      return Promise.all([autocompletePromise, coverImagePromise]).then(function(values) {
        console.log(`"${workSlug}" is ready to see.`);
      });
    }
  });

function handleCoverImage(workSlug, work) {
  const JPEG_EXTENSION = '.jpg';

  const bucket = gcs.bucket("alejost848-afea9.appspot.com");

  // Exit if there's no cover image
  if (!work.coverImage) {
    return null;
  }

  const coverPath = work.coverImage.path;
  const coverDirectory = path.dirname(coverPath);
  const coverNameOnly = path.basename(coverPath, path.extname(coverPath));

  // Exit if the image is already compressed
  if (coverNameOnly.startsWith('compressed_')) {
    return null;
  }

  const compressedCoverPath = path.normalize(path.format({dir: coverDirectory, name: `compressed_${coverNameOnly}`, ext: JPEG_EXTENSION})); // Compressed image path
  const thumbnailPath = path.join(coverDirectory, `thumb_${coverNameOnly}${JPEG_EXTENSION}`); // Thumbnail image path

  const tempCoverPath = path.join(os.tmpdir(), coverPath); // Temporary local file
  const tempLocalDir = path.dirname(tempCoverPath);
  const tempCompressedCoverPath = path.join(os.tmpdir(), compressedCoverPath); // Temporary JPEG file
  const tempThumbnailPath = path.join(os.tmpdir(), thumbnailPath); // Temporary JPEG file

  // Create the temp directory where the storage file will be downloaded.
  return mkdirp(tempLocalDir).then(() => {
    // Download file from bucket.
    return bucket.file(coverPath).download({ destination: tempCoverPath });
  }).then(() => {
    console.log('Image downloaded locally to', tempCoverPath);
    // Convert image to JPEG with lower quality to reduce file size
    return spawn('convert', [tempCoverPath, '-strip', '-quality', '80', tempCompressedCoverPath]);
  }).then(() => {
    console.log('Compressed image created at', tempCoverPath);
    // Upload the compressed image
    return bucket.upload(tempCompressedCoverPath, { destination: compressedCoverPath, metadata: { cacheControl: 'public, max-age=691200' } });
  }).then(() => {
    console.log('Compressed image uploaded to bucket.');
    // Generate the thumbnail
    return spawn('convert', [tempCoverPath, '-thumbnail', '320x180>', tempThumbnailPath]);
  }).then(() => {
    console.log('Thumbnail created at', tempThumbnailPath);
    // Upload the thumbnail.
    return bucket.upload(tempThumbnailPath, { destination: thumbnailPath, metadata: { cacheControl: 'public, max-age=691200' } });
  }).then(() => {
    console.log('Thumbnail uploaded to bucket.');
    // Remove original cover image from bucket
    return bucket.file(coverPath).delete();
  }).then(() => {
    console.log('Original cover removed from bucket.');

    // Delete the local files to free up disk space.
    fs.unlinkSync(tempCoverPath);
    fs.unlinkSync(tempCompressedCoverPath);
    fs.unlinkSync(tempThumbnailPath);

    // Get the Signed URLs for the compressed cover and thumbnail.
    const config = {
      action: 'read',
      expires: '03-01-2500'
    };

    const getCompressedCoverUrl = bucket.file(compressedCoverPath).getSignedUrl(config);
    const getThumbnailUrl = bucket.file(thumbnailPath).getSignedUrl(config);

    return Promise.all([getCompressedCoverUrl, getThumbnailUrl]);
  }).then((signedUrls) => {
    console.log('Download URLs generated.', signedUrls[0][0], signedUrls[1][0]);
    // Upload the information to the database
    return admin.database().ref(`/works/${workSlug}`).update({
      coverImage: {
        downloadUrl: signedUrls[0][0],
        path: compressedCoverPath
      },
      thumbnail: signedUrls[1][0]
    });
  }).then(() => {
    console.log('Images saved to the database.');
    return null;
  });
}

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

exports.sendNotification = functions.database
  .ref('/dashboard/notifications/{key}')
  .onCreate((snap, context) => {
    const notification = snap.val();
    const payload = {
      notification: {
        title: notification.title,
        body: notification.body,
        icon: notification.icon,
        click_action: notification.click_action
      }
    };
    return admin.messaging().sendToTopic('/topics/all', payload)
      .then(() => {
        console.log(`Notification sent: "${notification.title}".`);
      });
  });

exports.handleSubscription = functions.database
  .ref('/users/{uid}')
  .onWrite((change, context) => {
    const uid = context.params.uid;

    // If we are deleting the user stop doing stuff
    if (!change.after.exists()) {
      console.log(`User: ${uid} was removed`);
      return null;
    }

    const userToken = change.after.val().token;
    const subscribed = change.after.val().subscribed;

    //If token or subscribed values are not present stop
    if (userToken == null || subscribed == null) {
      return null;
    }

    const subscriptions = admin.database().ref('dashboard/overview/subscriptions');

    if (subscribed) {
      return admin.messaging().subscribeToTopic(userToken, '/topics/all').then(response => {
        if (response.errors.length > 0) {
          console.log("Errors subscribing to topic", response.errors);
        } else {
          console.log("Successfully subscribed to topic", response);
          return subscriptions.transaction(number => {
            return number + 1;
          });
        }
      }).catch(function(error) {
        console.log("Error subscribing to topic:", error);
        return null;
      });
    } else {
      return admin.messaging().unsubscribeFromTopic(userToken, '/topics/all').then(response => {
        if (response.errors.length > 0) {
          console.log("Errors unsubscribing from topic", response.errors);
        } else {
          console.log("Successfully unsubscribed from topic", response);
          return subscriptions.transaction(number => {
            return number - 1;
          });
        }
      }).catch(function(error) {
        console.log("Error unsubscribing from topic:", error);
        return null;
      });
    }

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
    requestPromise({
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

exports.handleImages2 = functions.storage.object().onFinalize((object, context) => {

  const fileBucket = object.bucket; // The Storage bucket that contains the file.
  const bucket = gcs.bucket(fileBucket);
  const filePath = object.name; // File path in the bucket.
  const directoryName = path.dirname(filePath); // Get the directory name.
  const fileName = path.basename(filePath); // Get the file name.

  const contentType = object.contentType; // File content type.
  const resourceState = object.resourceState; // The resourceState is 'exists' or 'not_exists' (for file/folder deletions).

  // Exit if this is triggered on a file that is not an image.
  if (!contentType.startsWith('image/')) {
    console.log('This is not an image.');
    return null;
  }

  // Exit if the image is not a cover.
  if (!directoryName.endsWith('/cover')) {
    // TODO: Do something for other images, here or in the addWork function
    console.log('This is a normal image.');
    return null;
  }

  // Return null for cover related stuff
  console.log("Nothing to do here.");
  return null;
});

exports.handleImagesDeletion = functions.storage.object().onDelete((object, context) => {

  const fileBucket = object.bucket; // The Storage bucket that contains the file.
  const bucket = gcs.bucket(fileBucket);
  const filePath = object.name; // File path in the bucket.
  const directoryName = path.dirname(filePath); // Get the directory name.
  const fileName = path.basename(filePath); // Get the file name.

  // If the compressed image is deleted, delete the thumbnail too by removing the cover folder
  if (fileName.startsWith('compressed_')) {
    return bucket.deleteFiles({ prefix: directoryName })
      .then(() => {
        console.log('Cover folder deleted.');
      });
  }
});

exports.host = functions.https.onRequest((req, res) => {

  const userAgent = req.headers['user-agent'].toLowerCase();
  const path = req.path.split("/");

  const isBot = userAgent.includes('yahoou') ||
		userAgent.includes('bingbot') ||
		userAgent.includes('baiduspider') ||
		userAgent.includes('yandex') ||
		userAgent.includes('yeti') ||
		userAgent.includes('yodaobot') ||
		userAgent.includes('gigabot') ||
		userAgent.includes('ia_archiver') ||
		userAgent.includes('facebookexternalhit') ||
		userAgent.includes('twitterbot') ||
		userAgent.includes('slackbot') ||
		userAgent.includes('developers\.google\.com') ? true : false;

  //If the userAgent is a bot then render the tags for it
  if (isBot){
    let view = path[1];
    //Get data from database to construct the meta tags
    if (view == "work") {
      let slug = path[2];

      admin.database().ref(`works/${slug}`).once('value', (snapshot) => {
        const item = snapshot.val();
        let tags = {
          "title": `${item.title} - Alejandro Sanclemente`,
          "og:title": `${item.title} - Alejandro Sanclemente`,
          "description": item.shortDescription,
          "og:description": item.shortDescription,
          "og:type": "article",
          "og:image": item.videoId ? `https://i.ytimg.com/vi/${item.videoId}/maxresdefault.jpg` : item.coverImage.downloadUrl,
          "og:url": `https://alejo.st${req.path}`
        };
        res.status(200).send(generateMetaTags(tags));
      });
    } else if (view == "tutorial") {
      let seriesName = path[2];
      let tutorialSlug = path[3];

      admin.database().ref(`tutorials/${seriesName}/videos/`)
        .orderByChild("slug")
        .equalTo(tutorialSlug)
        .once('child_added', (snapshot) => {
          const item = snapshot.val();
          let tags = {
            "title": `${item.title} - Alejandro Sanclemente`,
            "og:title": `${item.title} - Alejandro Sanclemente`,
            "description": item.shortDescription,
            "og:description": item.shortDescription,
            "og:type": "article",
            "og:image": item.videoId ? `https://i.ytimg.com/vi/${item.videoId}/maxresdefault.jpg` : item.coverImage.downloadUrl,
            "og:url": `https://alejo.st${req.path}`
          };
          res.status(200).send(generateMetaTags(tags));
        });
    } else {
      //All other views
      let tags = {
        "title": "Alejandro Sanclemente - Motion Designer and PWA Developer",
        "og:title": "Alejandro Sanclemente - Motion Designer and PWA Developer",
        "description": "Interactive Media Designer based in Tuluá, Colombia. I specialize in motion design, UX design and development of Progressive Web Apps using Polymer and Firebase.",
        "og:description": "Interactive Media Designer based in Tuluá, Colombia. I specialize in motion design, UX design and development of Progressive Web Apps using Polymer and Firebase.",
        "og:type": "website",
        "og:image": "https://alejo.st/images/cover.png",
        "og:url": `https://alejo.st${req.path}`
      };
      res.status(200).send(generateMetaTags(tags));
    }
  } else {
    //If it's not a bot, send the index file untouched
    res.status(200).send(fs.readFileSync('./hosting/index.html').toString());
  }
});

function generateMetaTags(tags){
  let tagsString = '';
  for (var key in tags) {
    if (tags.hasOwnProperty(key)) {
      //Title is a special case
      if (key == 'title') {
        tagsString += `<title>${tags[key]}</title>`;
      } else {
        // Check if it's Open Graph or regular meta tags to correctly set the attribute
        const attribute = key.substring(0, 3) === 'og:' ? 'property' : 'name';
        let escapedString = tags[key].replace(/\"/g,'&quot;');
        tagsString += `<meta ${attribute}="${key}" content="${escapedString}"/>`;
      }
    }
  }
	return tagsString;
};
