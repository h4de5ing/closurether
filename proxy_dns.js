'use strict';

var fs = require('fs'),
	net = require('net'),
	server = require("dgram").createSocket("udp4");

var CONN_TIMEOUT = 2000,
	FLAG_RES = 0x8000,
	PUB_DNS = '8.8.8.8';

var queueMap = {};

var domain_type = {},
	TYPE_PENDING = 0,
	TYPE_WEB = 1,
	TYPE_APP = 2;


var qid_addr = [],
	ipBuf,
	bufAns = new Buffer([			//+16 bytes
		0xC0, 0x0C,					// domain ptr
		0x00, 0x01,					// type
		0x00, 0x01,					// class
		0x00, 0x00, 0x00, 0x0A,		// ttl
		0x00, 0x04,					// len
		0x00, 0x00, 0x00, 0x00,		// ip
	]);


function buildReply(bufReq, ipBuf) {
	//
	// DNS回复包和请求包 前面部分相同，
	// 所以可在请求包的基础上扩充。
	//
	var reply = new Buffer(bufReq.length + 16);
	bufReq.copy(reply);					// 前面部分（和请求的一样）

	ipBuf.copy(bufAns, +12);			// 填充我们的IP地址
	bufAns.copy(reply, bufReq.length);	// 后面部分（bufAns数据）

	reply.writeUInt16BE(0x8180, +2);	// [02~03] flags
	reply.writeUInt16BE(0x0001, +6);	// [06~07] answer-couter
	return reply;
}


function conn(host, port, listener) {
	var s = net.connect(port, host, function() {
		s.destroy();
		listener.ok();
	});

	function fail() {
		s.destroy();
		listener.fail();
	}
	s.setTimeout(CONN_TIMEOUT, fail);
	s.on('error', fail);
}




server.on("message", function(msg, rAddr) {
	var reqId = msg.readUInt16BE(+0);
	var reqFlag = msg.readUInt16BE(+2);

	//
	// 外网DNS服务器的答复，转给用户
	//
	if (reqFlag & FLAG_RES) {
		var ep = qid_addr[reqId];
		if (ep) {
			server.send(msg,
				0, msg.length,
				ep.port,
				ep.address
			);
			delete qid_addr[reqId];
		}
		return;
	}

	function sendPub() {
		// 发给外网DNS
		qid_addr[reqId] = rAddr;
		server.send(msg,
			0, msg.length,
			53,
			PUB_DNS
		);
	}


	function reply() {
		// 回复用户查询
		var packet = buildReply(msg, ipBuf);
		server.send(packet,
			0, packet.length,
			rAddr.port,
			rAddr.address
		);
	}


	// 获取域名字符串
	var key = msg.toString('utf8', +12, msg.length - 5);
	var domain = key.replace(/[\u0000-\u0020]/g, '.').substr(1);


	var ok, fail = 0;

	function onConnOk() {
		if (ok) return;
		ok = true;

		domain_type[domain] = TYPE_WEB;

		// 该域名80或443可以连接，通知所有等待此域名的查询
		var i, queue = queueMap[domain];
		for(i = 0; i < queue.length; i++) {
			queue[i]();
		}
		delete queueMap[domain];
	}

	function onConnFail() {
		if (++fail != 2) return;

		domain_type[domain] = TYPE_APP;
		delete queueMap[domain];

		sendPub();
		console.warn('[DNS] `%s` is not a webdomain', domain);
	}


	switch(domain_type[domain]) {
	case TYPE_PENDING:      //** 该域名在在解析中
		queueMap[domain].push(reply);
		break;
	case TYPE_WEB:          //** 已知的Web域名
		reply();
		break;
	case TYPE_APP:          //** 已知的App域名
		sendPub();
		break;
	default:                //** 未知类型的域名
		domain_type[domain] = TYPE_PENDING;
		queueMap[domain] = [reply];

		//
		// 尝试连接该域名的80端口和443端口
		//
		conn(domain, 80, {
			ok: onConnOk,
			fail: onConnFail
		});
		conn(domain, 443, {
			ok: onConnOk,
			fail: onConnFail
		});
		break;
	}

	console.log('[DNS] %s\tQuery %s', rAddr.address, domain);
})


server.on("listening", function() {
	console.log("[DNS] running %s:%d",
		server.address().address,
		server.address().port
	);
});

server.on("error", function() {
	console.error('[DNS] fail listen UDP:53');
});



exports.start = function() {
	server.bind(53);
}

exports.stop = function() {
	server.close();
}

exports.setPubDNS = function(ip) {
	PUB_DNS = ip;
}

exports.setLocalIP = function(ip) {
	ipBuf = new Buffer(ip.split('.'));
}
