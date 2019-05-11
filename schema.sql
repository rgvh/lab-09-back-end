DROP TABLE IF EXISTS weathers;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS yelps;
DROP TABLE IF EXISTS movies;
DROP TABLE IF EXISTS trails;
DROP TABLE IF EXISTS locations;

CREATE TABLE locations (
  id SERIAL PRIMARY KEY,
  search_query VARCHAR(255),
  formatted_query VARCHAR(255),
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7)
);

CREATE TABLE weathers (
  id SERIAL PRIMARY KEY,
  forecast VARCHAR(255),
  time VARCHAR(255),
  created_at VARCHAR(255),
  location_id INTEGER NOT NULL,
  FOREIGN KEY (location_id) REFERENCES locations (id)
);

CREATE TABLE events (
  id SERIAL PRIMARY KEY,
  link VARCHAR(255),
  name VARCHAR(255),
  event_date VARCHAR(255),
  summary TEXT,
  location_id INTEGER NOT NULL,
  created_at VARCHAR(255),
  FOREIGN KEY (location_id) REFERENCES locations (id)
);

CREATE TABLE movies (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255),
  overview TEXT,
  average_votes VARCHAR(255),
  total_votes VARCHAR(255),
  image_url VARCHAR(255),
  popularity VARCHAR(255),
  released_on VARCHAR(255),
  created_at VARCHAR(255),
  location_id INTEGER NOT NULL,
  FOREIGN KEY (location_id) REFERENCES locations (id)
);

CREATE TABLE yelps (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  image_url VARCHAR(255),
  price VARCHAR(255),
  rating VARCHAR(255),
  url VARCHAR(255),
  created_at VARCHAR(255),
  location_id INTEGER NOT NULL,
  FOREIGN KEY (location_id) REFERENCES locations (id)
);

CREATE TABLE trails (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  location VARCHAR(255),
  length VARCHAR(255),
  stars VARCHAR(255),
  star_votes VARCHAR(255),
  summary VARCHAR(255),
  trail_url VARCHAR(255),
  conditions VARCHAR(255),
  condition_date VARCHAR(255),
  condition_time VARCHAR(255),
  created_at VARCHAR(255),
  location_id INTEGER NOT NULL,
  FOREIGN KEY (location_id) REFERENCES locations (id)
);
