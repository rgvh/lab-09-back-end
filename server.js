'use strict'

// Load environment variables
require('dotenv').config();

//Load express to do the heavey lifting -- Application dependencies
const express = require('express');
const superagent = require('superagent');
const cors = require('cors'); //Cross Origin Resource Sharing
const pg = require('pg'); //postgress

//Application setup
const app = express();
app.use(cors()); //tell express to use cors
const PORT = process.env.PORT;

//connect to database
const client = new pg.Client(process.env.DATABASE_URL); // part of posgres library
client.connect();
client.on('error', err => console.log(err));

app.get('/location', searchToLatLong)
app.get('/weather', getWeather);
app.get('/events', getEvent);
app.get('/movies', getMovies);
app.get('/yelp', getYelp);
app.get('/trails', getTrails);

//server listening for requests
app.listen(PORT, ()=> console.log(`city explorer back end Listening on PORT ${PORT}`));

function getDataFromDB(sqlInfo){
  // create sql statement
  let condition = '';
  let values = [];

  if (sqlInfo.searchQuery){
    condition = 'search_query';
    values = [sqlInfo.searchQuery];
  } else {
    condition = 'location_id';
    values = [sqlInfo.id];
  }

  let sql = `SELECT * FROM ${sqlInfo.endpoint}s WHERE ${condition}=$1`;

  // Get the data and return it
  try {return client.query(sql, values);}
  catch(error){ handleError(error);}
}

function saveDataToDB(sqlInfo){
  // param placeholder
  let params = [];

  for (let i=1; i<= sqlInfo.values.length;i++){
    params.push(`$${i}`)
  }

  let sqlParams = params.join();

  let sql = '';
  if (sqlInfo.searchQuery){
    // loc
    sql = `INSERT INTO ${sqlInfo.endpoint}s (${sqlInfo.columns}) VALUES (${sqlParams}) RETURNING ID;`
  } else {
    // all other endpoints since loc is a little special
    sql = `INSERT INTO ${sqlInfo.endpoint}s (${sqlInfo.columns}) VALUES (${sqlParams});`
  }

  // save all this hardly won data nom nom nom

  try {return client.query(sql, sqlInfo.values);}
  catch(err){handleError(err);}
}

function checkTimeouts(sqlInfo, sqlData) {

  const timeouts = {
    weather: 15 * 1000, // 15-seconds
    yelp: 24 * 1000 * 60 * 60, // 24-Hours
    movie: 30 * 1000 * 60 * 60 * 24, // 30-Days
    event: 6 * 1000 * 60 * 60, // 6-Hours
    trail: 7 * 1000 * 60 * 60 * 24 // 7-Days
  };

  // if there is data, find out how old it is.
  if (sqlData.rowCount > 0) {
    let ageOfResults = (Date.now() - sqlData.rows[0].created_at);

    // For debugging only
    console.log(sqlInfo.endpoint, ' AGE:', ageOfResults);
    console.log(sqlInfo.endpoint, ' Timeout:', timeouts[sqlInfo.endpoint]);

    // Compare the age of the results with the timeout value
    // Delete the data if it is old
    if (ageOfResults > timeouts[sqlInfo.endpoint]) {
      let sql = `DELETE FROM ${sqlInfo.endpoint}s WHERE location_id=$1;`;
      let values = [sqlInfo.id];
      client.query(sql, values)
        .then(() => { return null; })
        .catch(error => handleError(error));
    } else { return sqlData; }
  }
}

function searchToLatLong(request, response){
  let sqlInfo = {
    searchQuery: request.query.data,
    endpoint: 'location'
  };
  getDataFromDB(sqlInfo)
    .then(result => {
      if (result.rowCount >0){
        response.send(result.rows[0]);
      } else {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${request.query.data}&key=${process.env.GEOCODE_API_KEY}`;
        superagent.get(url)
          .then(result => {
            if (!result.body.results.length) {throw 'NO DATA';}
            else {
              let location = new Location(sqlInfo.searchQuery, result.body.results[0]);
              sqlInfo.columns = Object.keys(location).join();
              sqlInfo.values = Object.values(location);
              saveDataToDB(sqlInfo)
                .then(data => {
                  location.id = data.rows[0].id;
                  response.send(location);
                });
            }
          })
          .catch(err => handleError(err, response));
      }
    })
}

function getWeather(request, response) {
  let sqlInfo = {
    id: request.query.data.id,
    endpoint: 'weather'
  };

  getDataFromDB(sqlInfo)
    .then(data => checkTimeouts(sqlInfo,data))
    .then(result => {
      if (result) {response.send(result.rows);}
      else {
        const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${request.query.data.latitude},${request.query.data.longitude}`;

        return superagent.get(url)
          .then(weatherResults => {
            // console.log('line 101','weather from API');
            if (!weatherResults.body.daily.data.length) { throw 'NO DATA'; }
            else {
              const weatherSummaries = weatherResults.body.daily.data.map( day => {
                let summary = new Weather(day);
                summary.location_id = sqlInfo.id;

                sqlInfo.columns = Object.keys(summary).join();
                sqlInfo.values = Object.values(summary);

                saveDataToDB(sqlInfo)
                return summary;
              });
              response.send(weatherSummaries);
            }
          })
          .catch(err => handleError(err, response));
      }
    });
}

function getEvent(request, response) {
  let sqlInfo = {
    id: request.query.data.id,
    endpoint: 'event'
  };

  getDataFromDB(sqlInfo)
    .then(data => checkTimeouts(sqlInfo, data))
    .then(result => {
      if(result){response.send(result.rows);}
      else {
        const url = `https://www.eventbriteapi.com/v3/events/search/?token=${process.env.EVENTBRITE_API_KEY}&location.latitude=${request.query.data.latitude}&location.longitude=${request.query.data.longitude}`;

        return superagent.get(url)
          .then(eventResults => {
            if (!eventResults.body.events.length) { throw 'NO DATA'; }
            else {
              const eventSummaries = eventResults.body.events.map( events => {
                let summary = new Event(events);
                summary.location_id = sqlInfo.id;

                sqlInfo.columns = Object.keys(summary).join();
                sqlInfo.values = Object.values(summary);

                saveDataToDB(sqlInfo);
                return summary;
              });
              response.send(eventSummaries);
            }
          })
          .catch(err => handleError(err, response));
      }
    });
}

function getMovies(request, response) {
  let sqlInfo = {
    id: request.query.data.id,
    endpoint: 'movie'
  };

  getDataFromDB(sqlInfo)
    .then(data => checkTimeouts(sqlInfo,data))
    .then(result => {
      if (result) {response.send(result.rows);}
      else {
        const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIE_API_KEY}&language=en-US&query=${request.query.data.formatted_address.split(',')[0]}&page=1&include_adult=false`;
        console.log(request.query.data.formatted_address);

        return superagent.get(url)
          .then(movieResults => {

            if (!movieResults.body.results.length) { throw 'NO DATA'; }
            else {
              const movieSummaries = movieResults.body.results.map( movie => {
                let summary = new Movie(movie);
                summary.location_id = sqlInfo.id;
                sqlInfo.columns = Object.keys(summary).join();
                sqlInfo.values = Object.values(summary);

                saveDataToDB(sqlInfo);
                return summary;
              });
              response.send(movieSummaries);
            }
          })
          .catch(err => handleError(err, response));
      }
    });
}

function getYelp (request, response) {
  let sqlInfo = {
    id: request.query.data.id,
    endpoint: 'yelp'
  };
  getDataFromDB(sqlInfo)
    .then(data => checkTimeouts(sqlInfo,data))
    .then(result => {
      if (result) {response.send(result.rows);}
      else {
        const url = `https://api.yelp.com/v3/businesses/search?latitude=${request.query.data.latitude}&longitude=${request.query.data.longitude}`;

        return superagent.get(url)
          .set({'Authorization': 'Bearer '+ process.env.YELP_API_KEY})
          .then(yelpResults => {

            if (!yelpResults.body.businesses.length) { throw 'NO DATA'; }
            else {
              const yelpSummaries = yelpResults.body.businesses.map( biz => {
                let summary = new Yelp(biz);

                summary.location_id = sqlInfo.id;

                sqlInfo.columns = Object.keys(summary).join();
                sqlInfo.values = Object.values(summary);

                saveDataToDB(sqlInfo);
                return summary;
              });
              response.send(yelpSummaries);
            }
          })
          .catch(err => handleError(err, response));
      }
    });
}

function getTrails (request, response){
  let sqlInfo = {
    id: request.query.data.id,
    endpoint: 'trail'
  };
  getDataFromDB(sqlInfo)
    .then(data => checkTimeouts(sqlInfo,data))
    .then(result => {
      if(result){response.send(result.rows);}
      else {
        const url = `https://www.hikingproject.com/data/get-trails?lat=${request.query.data.latitude}&lon=${request.query.data.longitude}&key=${process.env.TRAIL_API_KEY}`;

        return superagent.get(url)
          .then(trailResults => {
            if(!trailResults.body.trails.length){throw 'NO DATA';}
            else {
              const trailSummaries = trailResults.body.trails.map(trail => {
                let summary = new Trail(trail);
                summary.location_id = sqlInfo.id;
                sqlInfo.columns = Object.keys(summary).join();
                sqlInfo.values = Object.values(summary);

                saveDataToDB(sqlInfo);
                return summary;
              });
              response.send(trailSummaries);
            }
          })
          .catch(err => handleError(err, response));
      }
    });
}

// Constructors
function Location(query, location) {
  this.search_query = query;
  this.formatted_address = location.formatted_address;
  this.latitude = location.geometry.location.lat;
  this.longitude = location.geometry.location.lng;
}

function Weather(day) {
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toString().slice(0, 15);
  this.created_at = Date.now();
}

function Event(event) {
  this.link = event.url;
  this.name = event.name.text;
  this.summary = event.summary;
  this.event_date = new Date(event.start.local).toString().slice(0, 15);
  this.created_at = Date.now();
}

function Movie (movie) {
  this.title = movie.original_title;
  this.overview = movie.overview.slice(0,750);
  this.average_votes = movie.vote_average;
  this.total_votes = movie.vote_count;
  this.image_url = `https://image.tmdb.org/t/p/original${movie.poster_path}` ;
  this.popularity = movie.popularity;
  this.released_on = movie.release_date;
  this.created_at = Date.now();
}

function Yelp (yelp) {
  this.name = yelp.name;
  this.image_url = yelp.image_url;
  this.price = yelp.price;
  this.rating = yelp.rating;
  this.url = yelp.url;
  this.created_at = Date.now();
}

function Trail (trail){
  this.name = trail.name;
  this.location = trail.location;
  this.length = trail.length;
  this.stars = trail.stars;
  this.star_votes = trail.starVotes;
  this.summary = trail.summary;
  this.trail_url = trail.url;
  this.conditions = trail.conditionDetails;
  this.condition_date = trail.conditionDate.split(' ')[0];
  this.condition_time = trail.conditionDate.split(' ')[1];
  this.created_at = Date.now();
}

//error handler
function handleError(err, response) {
  console.log(err);
  if (response) response.status(500).send('Sorry something went wrong');
}