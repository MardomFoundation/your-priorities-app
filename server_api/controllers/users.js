var express = require('express');
var router = express.Router();
var models = require("../models");
var passport = require('passport');
var auth = require('../authorization');
var log = require('../utils/logger');

var sendUserOrError = function (res, user, context, error, errorStatus) {
  if (error || !user) {
    if (errorStatus == 404) {
      log.warning("User Not Found", { context: context, err: error, user: user,
                                      errorStatus: 404 });
    } else {
      log.error("User Error", { context: context, post: post, user: user, err: error,
                                errorStatus: errorStatus ? errorStatus : 500 });
    }
    if (errorStatus) {
      res.sendStatus(errorStatus);
    } else {
      res.sendStatus(500);
    }
  } else {
    res.send(user);
  }
};

// Login
router.get('/login', passport.authenticate('local'), function (req, res) {
  log.info('User Login', { context: 'view', user: req.user });
  res.send(req.user);
});

// Register
router.post('/register', function (req, res) {
  var user = models.User.build({
    email: req.body.email,
    name: req.body.name
  });
  user.createPasswordHash(req.body.password);
  user.save().then(function () {
    log.info('User Created', { user: user, context: 'create', loggedInUser: req.user });
    req.logIn(user, function (error) {
      sendUserOrError(res, user, 'registerUser', error, 401);
    });
  }).catch(function (error) {
    sendUserOrError(res, null, 'create', error);
  });
});

// Edit User
router.put('/:id', auth.can('edit user'), function (req, res) {
  models.User.find({
    where: {id: req.params.id}
  }).then(function (user) {
    if (user) {
      user.name = req.body.name;
      user.email = req.body.email;
      user.save().then(function () {
        log.info('User Updated', { user: user, context: 'update', loggedInUser: req.user });
        user.setupImages(req.body, function (error) {
          sendUserOrError(res, user, 'setupImages', error);
        });
      });
    } else {
      sendUserOrError(res, req.params.id, 'update', 'Not found', 404);
    }
  });
});

router.get('/isloggedin', function (req, res) {
  log.info('User Logged in', { user: req.user, context: 'isLoggedIn'});
  res.send(req.isAuthenticated() ? req.user : '0');
});

router.post('/logout', function (req, res) {
  if (req.isAuthenticated()) {
    log.info('User Logging out', { user: req.user, context: 'logout'});
  } else {
    log.warning('User Logging out vut not logged in', { user: req.user, context: 'logout'});
  }
  req.logOut();
  res.sendStatus(200);
});

// Reset password
router.post('/forgot_password', function(req, res) {
  async.waterfall([
    function(done) {
      crypto.randomBytes(20, function(error, buf) {
        var token = buf.toString('hex');
        done(error, token);
      });
    },
    function(token, done) {
      models.User.find({
        where: { email: req.body.email }
      }).then(function (user) {
        if (user) {
          user.reset_password_token = token;
          user.reset_password_expires = Date.now() + 3600000; // 1 hour
          user.save().then(function () {
            log.info('User Reset Password Token Created', { user: user, context: 'forgotPassword', loggedInUser: req.user });
            done(null, token, user);
          });
        } else {
          log.info('User Reset Password Token Not Found', { user: user, context: 'forgotPassword', loggedInUser: req.user, error: 'Token not found', errorStatus: 404 });
          res.sendStatus(404);
          return;
        }
      }).catch(function (error) {
        log.error('User Reset Password Token Error', { user: null, context: 'forgotPassword', loggedInUser: req.user, err: error, errorStatus: 500 });
        res.sendStatus(500);
      });
    },
    function(token, user, done) {
      models.AcActivity.createPasswordRecovery(user, req.ypDomain, req.ypCommunity, token, function (error) {
        done(error, token, user);
      });
    }
  ], function(error, token, user) {
    if (error) {
      log.error('User Reset Password Token Error', { user: user, context: 'forgotPassword', loggedInUser: req.user, err: error, errorStatus: 500 });
      res.sendStatus(500);
    } else {
      log.info('User Reset Password Token Activity Created', { user: user, context: 'forgotPassword', loggedInUser: req.user });
      res.sendStatus(200);
    }
  });
});

router.get('/reset/:token', function(req, res) {
  models.User.find({
    where:
    {
      reset_password_token: req.params.token,
      reset_password_expires: {
        $gt: Date.now()
      }
    }
  }).then(function (user) {
    if (user) {
      log.info('Get User For Reset Password Token', { user: user, context: 'getUserToken', loggedInUser: req.user, errorStatus: 401 });
      res.sendStatus(user);
    } else {
      log.error('Get User For Reset Password Token Not found', { user: null, context: 'getUserToken', err: 'Token not found', loggedInUser: req.user, errorStatus: 401 });
      res.sendStatus(404);
    }
  }).catch(function (error) {
    log.error('Get User For Reset Password Token Error', { user: null, context: 'getUserToken', loggedInUser: req.user, err: error, errorStatus: 500 });
    res.sendStatus(500);
  });
});


router.post('/reset/:token', function(req, res) {
  async.waterfall([
    function(done) {
      models.User.find({
        where:
        {
          reset_password_token: req.params.token,
          reset_password_expires: {
            $gt: Date.now()
          }
        }
      }).then(function (user) {
        if (user) {
          user.password = req.body.password;
          user.reset_password_token = null;
          user.reset_password_expires = null;

          user.save().then(function () {
            req.logIn(user, function (error) {
              if (error) {
                log.error('User Reset Password Cant login', { user: user, context: 'useResetToken', loggedInUser: req.user, err: error, errorStatus: 500 });
                res.sendStatus(401);
                return;
              } else {
                log.info('User Reset Password User logged in', { user: user, context: 'useResetToken', loggedInUser: req.user });
                done(error, user);
              }
            });
          });
        } else {
          log.info('User Reset Password Token Not found', { user: user, context: 'useResetToken'});
          res.sendStatus(404);
          return;
        }
      });
    },
    function(user, done) {
      models.AcActivity.createActivity(modes.AcActivity.ACTIVITY_PASSWORD_CHANGED, user, req.ypDomain, req.ypCommunity, function (error) {
        done(error, user);
      });
    }
  ], function(error) {
    if (error) {
      log.error('User Reset Password Token Error', { user: null, context: 'useResetToken', loggedInUser: req.user, err: error, errorStatus: 500 });
      res.sendStatus(500);
    } else {
      log.info('User Reset Password Completed', { user: user, context: 'useResetToken', loggedInUser: req.user });
      res.sendStatus(200);
    }
  });
});

// Facebook Authentication

app.get('/auth/facebook', passport.authenticate('facebook'));

app.get('/auth/facebook/callback',
  passport.authenticate('facebook', { failureRedirect: '/' }),
  function(req, res) {
    log.info('User Logged in from Facebook', { user: req.user, context: 'facebookCallback' });
    res.sendStatus(200);
  });

// Twitter Authentication
app.get('/auth/twitter',
  passport.authenticate('twitter'));

app.get('/auth/twitter/callback',
  passport.authenticate('twitter', { failureRedirect: '/' }),
  function(req, res) {
    log.info('User Logged in from Twitter', { user: req.user, context: 'twitterCallback' });
    res.sendStatus(200);
  });

// Google Authentication
app.get('/auth/google', passport.authenticate('google', { scope: 'https://www.google.com/m8/feeds' }));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  function(req, res) {
    log.info('User Logged in from Google', { user: req.user, context: 'googleCallback' });
    res.sendStatus(200);
  });

/*
router.get('/:id/endorsements', auth.can('view user'), function (req, res) {
  models.Endorsement.findAll({
    where: {user_id: req.params.id, status: 'active'},
    order: "created_at DESC"
  }).then(function (endorsements) {
    res.send(endorsements);
  });
});
*/

module.exports = router;
