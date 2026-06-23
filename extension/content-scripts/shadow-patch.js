// 在页面 JS 之前运行，把 closed shadow root 变成 open
// 这样后续脚本可以用 element.shadowRoot 访问内部元素
(function () {
  var origAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    if (init && init.mode === 'closed') {
      init.mode = 'open';
    }
    var shadowRoot = origAttachShadow.call(this, init);
    this._shadowRoot = shadowRoot;
    return shadowRoot;
  };
})();