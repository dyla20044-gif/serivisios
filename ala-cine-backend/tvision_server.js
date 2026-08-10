require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const tvisionRoutes = require('./routes_tvision');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/tvision', tvisionRoutes);

const PORT = process.env.TVISION_PORT || 4000;
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`TVision Server: ${PORT}`);
    });
  })
  .catch((error) => {
    console.error(error);
  });
