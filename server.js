'use strict';

// PROVIDE ACCESS TO ENVIRONMENTAL VARIABLES IN .env
require('dotenv').config();

// LOAD APP DEPENDENDIES
const express = require('express');
const superagent = require('superagent');
const cors = require('cors');
const pg = require('pg');

// APP SETUP
const app = express();
app.use(cors());
const PORT = process.env.PORT;

//Connecting to the database
const client = new pg.Client(process.env.DATABASE_URL);
client.connect();
client.on('error', err => console.log(err));

//API routes

app.get('/location', searchToLatLong);
app.get('/weather', getWeather);
app.get('/events', getEvents);

// TURN THE SERVER ON
app.listen(PORT, () => console.log(`Listening on PORT ${PORT}`));

// ERROR HANDLER
function handleError(err, response) {
  console.error(err);
  if (response) response.status(500).send('Sorry, something is not right');
}

// HELPER FUNCTIONS

//Function to get location data

function getDataFromDB(sqlInfo) {
  // Create a SQL Statement
  let condition = '';
  let values = [];

  if (sqlInfo.searchQuery) {
    condition = 'search_query';
    values = [sqlInfo.searchQuery];
  } else {
    condition = 'location_id';
    values = [sqlInfo.id];
  }

  let sql = `SELECT * FROM ${sqlInfo.endpoint}s WHERE ${condition}=$1;`;

  // Get the Data and Return
  try { return client.query(sql, values); }
  catch (error) { handleError(error); }
}

function saveDataToDB(sqlInfo) {
  // Create the parameter placeholders
  let params = [];

  for (let i = 1; i <= sqlInfo.values.length; i++) {
    params.push(`$${i}`);
  }

  let sqlParams = params.join();

  let sql = '';
  if (sqlInfo.searchQuery) {
    // location
    sql = `INSERT INTO ${sqlInfo.endpoint}s (${sqlInfo.columns})
    VALUES (${sqlParams}) RETURNING ID;`;
  } else {
    //all other endpoints
    sql = `INSERT INTO ${sqlInfo.endpoint}s (${sqlInfo.columns}) VALUES (${sqlParams});`;
  }

  // save the data
  try { return client.query(sql, sqlInfo.values); }
  catch (err) { handleError(err); }
}

//Cache Invalidation:

//bunch of steps

//Check to see if the data is still valid
function checkTimeouts(sqlInfo, sqlData) {
  const timeouts = {
    weather: 15 * 1000, //15 seconds
    yelp: 24 * 1000 * 60 * 60, //24 hours
    movie: 30 * 1000 * 60 * 60 * 24, //30 days
    event: 6 * 1000 * 60 * 60, //6 hours
    trail: 7 * 1000 * 60 * 60 * 24 //7 days
  };

  //if there is data, find out how old it is
  if (sqlData.rowCount > 0) {
    let ageOfResults = (Date.now() - sqlData.rows[0].created_at);

    //for debugging only
    console.log(sqlInfo.endpoint, ' AGE:', ageOfResults);
    console.log(sqlInfo.endpoint, ' Timeout:', timeouts[sqlInfo.endpoint]);

    //Compare the age of the results with the timeout value
    //Delete the data if it is old
    if (ageOfResults > timeouts[sqlInfo.endpoint]) {
      let sql = `DELETE FROM ${sqlInfo.endpoint}s WHERE location_id=$1;`;
      let values = [sqlInfo.id];
      client.query(sql, values)
        .then(() => { return null; })
        .catch(error => handleError(error));
    } else { return sqlData; }
  }
}

function searchToLatLong(request, response) {
  let sqlInfo = {
    searchQuery: request.query.data,
    endpoint: 'location'
  };

  getDataFromDB(sqlInfo)
    .then(result => {
      if (result.rowCount > 0) {
        response.send(result.rows[0]);
      } else {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${request.query.data}&key=${process.env.GEOCODE_API_KEY}`;

        superagent.get(url)
          .then(result => {
            if (!result.body.results.length) { throw 'NO DATA'; }
            else {
              let location = new Location(sqlInfo.searchQuery,
                result.body.results[0]);

              sqlInfo.columns = Object.keys(location).join();
              sqlInfo.values = Object.values(location);

              saveDataToDB(sqlInfo)
                .then(data => {
                  location.id = data.rows[0].id;
                  response.send(location);
                });
            }
          })
          .catch(error => handleError(error, response));
      }
    });
}

function getWeather(request, response) {
  let sqlInfo = {
    id: request.query.data.id,
    endpoint: 'weather'
  };

  getDataFromDB(sqlInfo)
    .then(data => checkTimeouts(sqlInfo, data))
    .then(result => {
      if (result) { response.send(result.rows); }
      else {
        const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${request.query.data.latitude},${request.query.data.longitude}`;

        return superagent.get(url)
          .then(weatherResults => {
            console.log('Weather from API');
            if (!weatherResults.body.daily.data.length) { throw 'NO DATA'; }
            else {
              const weatherSummaries = weatherResults.body.daily.data.map(day => {
                let summary = new Weather(day);
                summary.location_id = sqlInfo.id;

                sqlInfo.columns = Object.keys(summary).join();
                sqlInfo.values = Object.values(summary);

                saveDataToDB(sqlInfo);
                return summary;
              });
              response.send(weatherSummaries);
            }
          })
          .catch(error => handleError(error, response));
      }
    });
}


function getEvents(request, response) {
  console.log(request.query.data.id, 'ffffffuuuuuuuu');
  let sqlInfo = {
    id: request.query.data.id,
    endpoint: 'event'
  };


  getDataFromDB(sqlInfo)
    .then(data => checkTimeouts(sqlInfo, data))
    .then(result => {
      if (result) { response.send(result.rows); }
      else {
        const url = `https://www.eventbriteapi.com/v3/events/search?token=${process.env.EVENTBRITE_API_KEY}&location.address=${request.query.data.formatted_query}`;
        console.log(request.query.data);

        return superagent.get(url)
          .then(eventResults => {
            if (!eventResults.body.events.length) { throw 'NO DATA'; }
            else {
              console.log(eventResults);
              const eventSummaries = eventResults.body.events.map(event => {
                let summary = new Event(event);
                summary.location_id = sqlInfo.id;

                sqlInfo.columns = Object.keys(summary).join();
                sqlInfo.values = Object.values(summary);

                saveDataToDB(sqlInfo);
                return summary;
              });
              response.send(eventSummaries);
            }
          })
          .catch(error => handleError(error, response));
      }
    });
}


// function getEvents(request, response) {
//   let query = request.query.data.id;
//   let sql = `SELECT * FROM events WHERE location_id=$1;`;
//   let values = [query];

//   client.query(sql, values)
//     .then(result => {
//       if (result.rowCount > 0) {
//         response.send(result.rows);
//       } else {
//         const url = `https://www.eventbriteapi.com/v3/events/search?token=${process.env.EVENTBRITE_API_KEY}&location.address=${request.query.data.formatted_query}`;

//         return superagent.get(url)
//           .then(result => {
//             if (!result.body.events.length) { throw 'NO DATA'; }
//             else {
//               const eventSummaries = result.body.events.map(events => {
//                 let event = new Event(events);
//                 event.id = query;

//                 let newSQL = `INSERT INTO events (link, name, event_date, summary, location_id) VALUES ($1, $2, $3, $4, $5);`;
//                 let newValues = Object.values(event);

//                 client.query(newSQL, newValues);

//                 return event;
//               });
//               response.send(eventSummaries.slice(0, 20));
//             }
//           })
//           .catch(error => handleError(error, response));
//       }
//     });
// }


function Location(query, location) {
  this.search_query = query;
  this.formatted_query = location.formatted_address;
  this.latitude = location.geometry.location.lat;
  this.longitude = location.geometry.location.lng;
}

function Weather(day) {
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toString().slice(0, 15);
  this.created_at = Date.now();
}

//eventbrite constructor
function Event(event) {
  this.link = event.url;
  this.name = event.name.text;
  this.event_date = new Date(event.start.local).toDateString();
  this.summary = event.summary;
  this.created_at = Date.now();
}
