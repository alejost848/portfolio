const functions = require('firebase-functions');

// Create and Deploy Your First Cloud Functions
// https://firebase.google.com/docs/functions/write-firebase-functions

exports.test = functions.database
  .ref('/tutorials/{tutorialKey}')
  .onWrite(event => { //Trigger an event when a new tutorial is added

    // If we are deleting the data stop doing stuff
    if (!event.data.exists()) {
      console.log("Bye, data.");
      return;
    }

    // Only edit data when it is first created
    if (event.data.previous.exists()) {
      console.log("Hey, data exists already!");
      return;
    }

    // const tutorial = event.data.val();
    // return event.data.ref.update({mainColor: "test"});
  });
