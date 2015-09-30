"use strict";

var Q = require( 'q' ),
    utils = require( '../lib/utils' ),
    TError = require( '../lib/custom-error' ).TranslatedError,
    communicator = require( '../lib/communicator' ),
    surveyModel = require( '../models/survey-model' ),
    userModel = require( '../models/user-model' ),
    express = require( 'express' ),
    router = express.Router(),
    debug = require( 'debug' )( 'survey-controller' );

module.exports = function( app ) {
    app.use( '/', router );
};

// duplicate in submission-controller
router.param( 'enketo_id', function( req, res, next, id ) {
    if ( /^::[A-z0-9]{4,8}$/.test( id ) ) {
        req.enketoId = id.substring( 2 );
        next();
    } else {
        next( 'route' );
    }
} );

router
    .get( '*', loggedInCheck )
    .get( '/_', offlineWebform )
    .get( '/:enketo_id', webform )
    .get( '/preview/:enketo_id', preview )
    .get( '/preview', preview )
    .get( '/edit/:enketo_id', edit )
    .get( '/xform/:enketo_id', xform )
    .get( '/connection', function( req, res, next ) {
        res.status = 200;
        res.send( 'connected ' + Math.random() );
    } );

function loggedInCheck( req, res, next ) {
    req.logout = !!userModel.getCredentials( req );
    next();
}

function offlineWebform( req, res, next ) {
    var error;

    if ( !req.app.get( 'offline enabled' ) ) {
        error = new Error( 'Offline functionality has not been enabled for this application.' );
        error.status = 405;
        next( error );
    } else {
        req.manifest = '/_/manifest.appcache';
        webform( req, res, next );
    }
}

function webform( req, res, next ) {
    var options = {
        manifest: req.manifest,
        iframe: !!req.query.iframe,
        logout: req.logout
    };
	_retrieveAndValidateCustomLogo(req, options);
    _renderWebform( req, res, next, options );
}

function preview( req, res, next ) {
    var options = {
        type: 'preview',
        iframe: !!req.query.iframe,
        logout: req.logout
    };
	_retrieveAndValidateCustomLogo(req, options);
    _renderWebform( req, res, next, options );
}

function edit( req, res, next ) {
    var error,
        options = {
            type: 'edit',
            iframe: !!req.query.iframe,
            logout: req.logout
        };
	_retrieveAndValidateCustomLogo(req, options);
    if ( req.query.instance_id ) {
        _renderWebform( req, res, next, options );
    } else {
        error = new TError( 'error.invalidediturl' );
        error.status = 400;
        next( error );
    }
}

function _renderWebform( req, res, next, options ) {
    var deviceId = req.signedCookies[ '__enketo_meta_deviceid' ] || req.hostname + ':' + utils.randomString( 16 ),
        cookieOptions = {
            signed: true,
            maxAge: 10 * 365 * 24 * 60 * 60 * 1000
        };

    res
        .cookie( '__enketo_meta_deviceid', deviceId, cookieOptions )
        .render( 'surveys/webform', options );
}

/**
 * Debugging view that shows underlying XForm
 * @param  {[type]}   req  [description]
 * @param  {[type]}   res  [description]
 * @param  {Function} next [description]
 * @return {[type]}        [description]
 */
function xform( req, res, next ) {
    return surveyModel.get( req.enketoId )
        .then( function( survey ) {
            survey.credentials = userModel.getCredentials( req );
            return survey;
        } )
        .then( communicator.getXFormInfo )
        .then( communicator.getXForm )
        .then( function( survey ) {
            res
                .set( 'Content-Type', 'text/xml' )
                .send( survey.xform );
        } )
        .catch( next );
}
function _retrieveAndValidateCustomLogo(req, options) {

    var hasErrors = false;
    var customLogo, parentWindowOrigin, url, customLogoParts, originParts;

    function setErrorMessage(key, value) {
        if (options.submissionErrors === void(0)) {
            options.submissionErrors = {};
        }
        if (options.submissionErrors[key] === void(0)) {
            options.submissionErrors[key] = [];
        }
        options.submissionErrors[key].push(value);
        hasErrors = true;
    }

    if (!req.query.customLogo) {
        return;
    } else {
        customLogo = decodeURIComponent(req.query.customLogo);
    }


    // Security check, make sure not to let user run unexpected javascript in the context of our webpage.
    if (!customLogo.match(/^[\w:\/.-]+$/)) {
        setErrorMessage('customLogo', 'Must be of these characters: A..Z a..z 0..9 _:/.-');
    }

    // The query string parentWindowOrigin is required if you want to set custom logo, added security measures.
    if (!req.query.parentWindowOrigin) {
        setErrorMessage('parentWindowOrigin', 'Required by customLogo');
    } else {
        parentWindowOrigin = decodeURIComponent(req.query.parentWindowOrigin);
        // Logo image must be from the same host.
        url = require('url');
        customLogoParts = url.parse(customLogo);
        originParts = url.parse(parentWindowOrigin);

        if (customLogoParts.hostname !== originParts.hostname) {
            setErrorMessage(options, 'customLogo', 'Must be hosted in ' + originParts.hostname);
        }
    }

    if (hasErrors) {
        return;
    }

    delete customLogoParts.protocol;
    options.customLogo = url.format(customLogoParts);
}