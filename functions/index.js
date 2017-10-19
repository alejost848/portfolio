const functions = require('firebase-functions');
const slugify = require('slugify');

exports.createTutorialSlug = functions.database
  .ref('/tutorials/{tutorialKey}')
  .onCreate(event => { //Trigger an event when a new tutorial is added

    console.log("I'm here!");
    console.log(event.data.val());

    // return event.data.ref.update({mainColor: "test"});
  });
