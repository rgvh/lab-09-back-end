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

function getDataFromDB (sqlInfo) {
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
  if (sqqlInfo.searchQuery) {
    // location
    sql = `INSERT INTO ${sqlInfo.endpoint}s (${sqlInfo.columns})
    VALUES (${sqlParams}) RETURNING ID;`;
  } else {
    //all other endpoints
    sql = `INSERT INTO ${sqlInfo.endpoints}s (${sqlInfo.columns}) VALUES (${sqlParams});`;
  }

  // save the data
  try { return client.query(sql, sqlInfo.values); }
  catch (err) {handleError(err); }
}

function searchToLatLong(request, response) {
  let query = request.query.data;

  //Definte the search query
  let sql = `SELECT * FROM locations WHERE search_query=$1;`;
  let values = [query];

  //Makes the query of the database
  client.query(sql, values)
    .then(result => {
      console.log('result from database',
        result.rowCount);
      //did the DB return any info?
      if (result.rowCount > 0) {
        response.send(result.rows[0]);
      } else {
        //otherwise go get the data from the API
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${request.query.data}&key=${process.env.GEOCODE_API_KEY}`;

        superagent.get(url)
          .then(result => {
            if (!result.body.results.length) {
              throw 'NO DATA';
            } else {
              let location = new Location(query, result.body.results[0]);

              let newSQL = `INSERT INTO locations (search_query, formatted_address, latitude, longitude) VALUES ($1, $2, $3, $4) RETURNING ID;`;
              let newValues = Object.values(location);

              client.query(newSQL, newValues)
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

function Location(query, location) {
  this.search_query = query;
  this.formatted_query = location.formatted_address;
  this.latitude = location.geometry.location.lat;
  this.longitude = location.geometry.location.lng;
}

//function to get weather data
function getWeather(request, response) {
  let query = request.query.data.id;
  let sql = `SELECT * FROM weathers WHERE location_id=$1;`;
  let values = [query];

  client.query(sql, values)
    .then(result => {
      if (result.rowCount > 0) {
        // console.log('Weather from SQL');
        response.send(result.rows);
      } else {
        const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${request.query.data.latitude},${request.query.data.longitude}`;

        return superagent.get(url)
          .then(weatherResults => {
            // console.log('Weather from API');
            if (!weatherResults.body.daily.data.length) { throw 'NO DATA'; }
            else {
              const weatherSummaries = weatherResults.body.daily.data.map(day => {
                let summary = new Weather(day);
                summary.id = query;

                let newSql = `INSERT INTO weathers (forecast, time, location_id) VALUES($1, $2, $3);`;
                let newValues = Object.values(summary);
                // console.log(newValues);
                client.query(newSql, newValues);

                return summary;

              });
              response.send(weatherSummaries);
            }

          })
          .catch(error => handleError(error, response));
      }
    });
}

function Weather(day) {
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toString().slice(0, 15);
}


function getEvents(request, response) {
  let query = request.query.data.id;
  let sql = `SELECT * FROM events WHERE location_id=$1;`;
  let values = [query];

  client.query(sql, values)
    .then(result => {
      if(result.rowCount > 0) {
        response.send(result.rows);
      } else {
        const url = `https://www.eventbriteapi.com/v3/events/search?token=${process.env.EVENTBRITE_API_KEY}&location.address=${request.query.data.formatted_query}`;

        return superagent.get(url)
          .then(result => {
            if (!result.body.events.length) { throw 'NO DATA'; }
            else {
              const eventSummaries = result.body.events.map(events => {
                let event = new Event(events);
                event.id = query;

                let newSQL = `INSERT INTO events (link, name, event_date, summary, location_id) VALUES ($1, $2, $3, $4, $5);`;
                let newValues = Object.values(event);

                client.query(newSQL, newValues);

                return event;
              });
              response.send(eventSummaries.slice(0, 20));
            }
          })
          .catch(error => handleError(error, response));
      }
    });
}


//eventbrite constructor
function Event(event) {
  this.link = event.url;
  this.name = event.name.text;
  this.event_date = new Date(event.start.local).toDateString();
  this.summary = event.summary;
}

//Error handler
function handleError(err, response) {
  console.error(err);
  if (response) response.status(500).send('Sorry, something is not right');
}
