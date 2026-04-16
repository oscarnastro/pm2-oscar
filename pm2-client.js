const pm2 = require('pm2');

let connected = false;

function connectPm2() {
  if (connected) return Promise.resolve();

  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) return reject(err);
      connected = true;
      return resolve();
    });
  });
}

function listPm2() {
  return new Promise((resolve, reject) => {
    pm2.list((err, list) => {
      if (err) return reject(err);
      return resolve(list);
    });
  });
}

function pm2Action(action, target) {
  return new Promise((resolve, reject) => {
    pm2[action](target, (err, data) => {
      if (err) return reject(err);
      return resolve(data);
    });
  });
}

function describeProcess(id) {
  return new Promise((resolve, reject) => {
    pm2.describe(id, (err, desc) => {
      if (err) return reject(err);
      return resolve(desc && desc[0]);
    });
  });
}

function launchBus(callback) {
  pm2.launchBus(callback);
}

module.exports = {
  connectPm2,
  listPm2,
  pm2Action,
  describeProcess,
  launchBus
};
