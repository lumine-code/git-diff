module.exports = async function (goalPath) {
  return goalPath ? lumine.repositories.resolveForPath(goalPath) : null;
};
