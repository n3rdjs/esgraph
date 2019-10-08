/* eslint-disable import/newline-after-import */
/* eslint-disable no-console */
/* eslint-disable import/no-extraneous-dependencies */
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const esgraphRender = require('./esgraph-render');

const app = express();

app.engine('html', require('ejs').renderFile);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/scripts', express.static(path.join(__dirname, 'scripts')));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.render('index');
});

app.post('/dot', async (req, res) => {
  console.log(req.body);
  res.send(esgraphRender(req.body.code));
});

app.listen(3000, () => {
  console.log('Express server has started on port 3000');
});
