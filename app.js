var piano = Synth.createInstrument('piano');

//Dialogs
function openDialog (element){	
	var itemTitle = element.title;
	var itemCategory = element.subtitle;
	var itemContent = element.content;
	var itemYear = element.year;
	var itemSrc = element.video;

	var app = document.querySelector("#app");
 	
 	app.dialogTitle = itemTitle;
 	app.dialogSubtitle = itemCategory;
 	app.dialogContent = itemContent;
 	app.dialogYear = itemYear; 
 	app.dialogSrc = itemSrc; 

 	var dialogProject = document.getElementById("dialogProject");
 	dialogProject.openDialog(); 	
}

checkHash();
$(window).on('hashchange', function(e){
   checkHash();
});
function checkHash (){
	var currentHash = window.location.hash;	
	if (currentHash==""||currentHash=="#!/") {	
		document.querySelector("home-page").enabled = true;	
	}else{
		document.querySelector("home-page").enabled = false;
	}
}
