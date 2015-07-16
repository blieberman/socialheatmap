
$(document).ready(function() {

  var mapTiles = "http://{s}.tile.osm.org/{z}/{x}/{y}.png";
  var mapAttrib = "&copy; <a href=\"http://osm.org/copyright\">OpenStreetMap</a> contributors";

  var map = L.map("map").setView([0, 0], 2);
  map.addLayer(L.tileLayer(mapTiles, {attribution: mapAttrib}));

  var template = Handlebars.compile($("#picture-template").html());
  var markers = [];

  $("#map").hide();

  $("#toggle").click(function(e) {
    $("#toggle .button").removeClass("selected");
    $(e.target).addClass("selected");
    
    if (e.target.id == "grid-button") $("#map").hide();
    else $("#map").show();
  });

  function addPicture(picture) {
    picture.date = moment.unix(picture.created_time).format("MMM DD, h:mm a");
    $("#pictures").prepend(template(picture));

    if (picture.place) {
      var count = markers.unshift(L.marker(L.latLng(
          picture.place.coordinates[1],
          picture.place.coordinates[0])));

      map.addLayer(markers[0]);
      markers[0].bindPopup(
          "<img src=\"" + picture.images.thumbnail.url + "\">",
          {minWidth: 150, minHeight: 150});
      
      markers[0].openPopup();

      if (count > 100)
        map.removeLayer(markers.pop());
    }
  }

  var socket = io.connect();
  
  socket.on("picture", addPicture); 
  socket.on("recent", function(data) {
    data.reverse().forEach(addPicture);
  });

});
