var http = require('http');
var express = require('express');
var bodyParser = require("body-parser");
var ig = require('instagram-node-lib');
var sockio = require("socket.io");
var r = require("rethinkdb");
var q = require("q");

var app = express();
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(express.static(__dirname + "/public"));

var config = require("./config");

API = 'https://api.instagram.com/v1/'
CALLBACK_URL = 'http://x.x.x.x:3030/callback';
REDIRECT_URI = 'http://x.x.x.x:3030';
MAX_SOCKETS = 10;
var lastUpdate = 0;

var instagram = {
  // init the configuration for the instagram lib
  initialize: function() {
    ig.set('client_id', config.instagram.client_id);
    ig.set('client_secret', config.instagram.client_secret);
    ig.set('callback_url', CALLBACK_URL);
    ig.set('redirect_uri', REDIRECT_URI);
    ig.set('maxSockets', MAX_SOCKETS);

    ig.subscriptions.unsubscribe_all({});
  },

  //create a real-time instagram subscription via locations
  subscribeByLoc: function(lat,lon,rad) {
    ig.subscriptions.subscribe({
      object: 'geography',
      lat: lat,
      lng: lon,
      radius: rad,
      object_id: 'boston-pics',
      aspect: 'media',
      callback_url: CALLBACK_URL,
      type: 'subscription',
      id: '#'
    });
    console.log("Subscribed to location (" + lat +',' + lon + "," + rad + ")");
  },

  subscribeByTag: function(tag) {
    ig.subscriptions.subscribe({
      object: 'tag',
      object_id: tag,
      aspect: 'media',
      callback_url: CALLBACK_URL,
      type: 'subscription',
      id: '#'
    });
    console.log("Subscribed to hashtag " + tag);
  }
}

// set the server port
var io = sockio.listen(app.listen(config.port), {log: false});
console.log("Server started on port " + config.port);

/// init rethinkdb ///
var conn;
r.connect(config.database).then(function(c) {
  conn = c;
  return r.dbCreate(config.database.db).run(conn);
})
.then(function() {
  return r.tableCreate("igboston").run(conn);
})
.then(function() {
  return q.all([
    r.table("igboston").indexCreate("time").run(conn),
    r.table("igboston").indexCreate("place", {geo: true}).run(conn)
  ]);
})
.error(function(err) {
  if (err.msg.indexOf("already exists") == -1)
    console.log(err);
})
.finally(function() {
  r.table("igboston").changes().run(conn)
  .then(function(cursor) {
    cursor.each(function(err, item) {
      if (item && item.new_val)
        io.sockets.emit("picture", item.new_val);
    });
  })
  .error(function(err) {
    console.log("Error:", err);
  });

});
///

io.sockets.on("connection", function(socket) {
  var conn;
  r.connect(config.database).then(function(c) {
    conn = c;
    return r.table("igboston")
      .orderBy({index: r.desc("time")})
      .limit(60).run(conn)
  })
  .then(function(cursor) { return cursor.toArray(); })
  .then(function(result) {
    socket.emit("recent", result);
  })
  .error(function(err) { console.log("Failure:", err); })
  .finally(function() {
    if (conn)
      conn.close();
  });
});

instagram.initialize();
instagram.subscribeByLoc(40.745,-73.98,5000);
instagram.subscribeByLoc(42.345,-71.085,5000);
instagram.subscribeByLoc(34.01956,-118.4869,5000);
//instagram.subscribeByTag("beach");

// create a get callback for instagram api auth
app.get('/callback', function(req,res){
  ig.subscriptions.handshake(req,res);
  res.end()
});

// create a post callback from instagram api
app.post('/callback', function(req, res){
  var update = req.body;

  update.forEach(function(pic) {
    console.log("Incoming pic...");

    var path = API + 'geographies/' + pic.object_id
             + '/media/recent?client_id=' + config.instagram.client_id;
    var conn;
    r.connect(config.database).then(function(c) {
      conn = c;
      return r.table("igboston").insert(
        r.http(path)("data").merge(function(item) {
          return {
            time: r.now(),
            place: r.point(
              item("location")("longitude"),
              item("location")("latitude")).default(null)
          }
        })).run(conn)
    })
    .error(function(err) { console.log("Failure:", err); })
    .finally(function() {
      if (conn)
        conn.close();
    });
  });
  res.end();
});
