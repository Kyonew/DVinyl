/**
 * config/db.js
 *
 * Simple module to connect to MongoDB using Mongoose. Exports an async
 * function that establishes the connection using the `MONGDODB_URL`
 * environment variable. This keeps connection logic separated from the
 * application entrypoint and makes testing easier.
 */
const mongoose = require('mongoose');
require('dotenv').config();
const MONGDODB_URL = process.env.MONGDODB_URL;

module.exports = async () => {
  await mongoose.connect(MONGDODB_URL);
  console.log('MongoDB connected');
};
