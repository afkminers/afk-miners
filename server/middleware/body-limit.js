const express = require('express');

module.exports = function bodyParserLimited() {
  const limit = process.env.JSON_LIMIT || '64kb';
  return express.json({ limit });
};