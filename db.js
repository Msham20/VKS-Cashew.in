const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
let client;
let db;

async function connectToDatabase() {
  if (db) return db;
  
  if (!uri) {
    console.warn('MONGODB_URI environment variable not found. Database features will be disabled.');
    return null;
  }

  try {
    if (!client) {
      client = new MongoClient(uri);
      await client.connect();
    }
    db = client.db('casheew');
    console.log('Connected to MongoDB');
    return db;
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err.message);
    return null;
  }
}

module.exports = { connectToDatabase };
