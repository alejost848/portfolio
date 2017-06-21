const functions = require('firebase-functions');

// Create and Deploy Your First Cloud Functions
// https://firebase.google.com/docs/functions/write-firebase-functions

exports.test = functions.database
  .ref('/tutorials/{pushId}/thumbnail')
  .onWrite(event => {
    // Only edit data when it is first created.
    if (event.data.previous.exists()) {
      return;
    }
    // Exit when the data is deleted.
    if (!event.data.exists()) {
      return;
    }

    // TODO: Process image and get the dominant color
    let dominantColor = "OMG it worked!";
    return event.data.ref.set(dominantColor);
  });
