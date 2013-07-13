'use strict';

var config = require('./config.json'),
	inject = require('./inject.js'),
	proxyDns = require('./proxy_dns.js'),
	proxyWeb = require('./proxy_web.js'),
	os = require('os'),
	fs = require('fs');


function GetLocalIP() {
	var nifs = os.networkInterfaces();

	for(var i in nifs) {
		var adapters = nifs[i];

		for(var j in adapters) {
			var cfg = adapters[j];
			if (cfg.family != 'IPv4')
				continue;

			if (! /^(0|127|169)/.test(cfg.address))
				return cfg.address;
		}
	}
}


function printUsage() {
	console.log(fs.readFileSync('./usage.txt') + '');
	process.exit(0);
}


function main(argv) {
	for(var i = 0, n = argv.length; i < n; i++) {
		switch(argv[i]) {
		case '-d':
		case '--debug':
			config.debug = true;
			break;

		case '-h':
		case '--help':
			printUsage();
			break;
		}
	}

	var localIP = GetLocalIP();
	if (!localIP) {
		console.error('[SYS] cannot get local ip!');
		return;
	}
	console.log('[SYS] local ip:', localIP);

	inject.init();

	proxyDns.setLocalIP(localIP);
	proxyDns.start();

	proxyWeb.start();
}

main(process.argv);