const functions = require('firebase-functions');
const slugify = require('slugify');

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
