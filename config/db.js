/**
 * config/db.js
 *
 * Simple module to connect to MongoDB using Mongoose. Exports an async
 * function that establishes the connection using the `MONGODB_URL`
 * environment variable. This keeps connection logic separated from the
 * application entrypoint and makes testing easier.
 */
const mongoose = require('mongoose');
require('dotenv').config();
const MONGODB_URL = process.env.MONGODB_URL;

module.exports = async () => {
  await mongoose.connect(MONGODB_URL);
  console.log('MongoDB connected');
};
