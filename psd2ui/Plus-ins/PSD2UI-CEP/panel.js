"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __commonJS = (cb, mod) => function __require2() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // Plus-ins/PSD2UI-CEP/src/polyfills.js
  var require_polyfills = __commonJS({
    "Plus-ins/PSD2UI-CEP/src/polyfills.js"() {
      "use strict";
      if (typeof window !== "undefined" && typeof window.globalThis === "undefined") window.globalThis = window;
      if (!Object.fromEntries) Object.fromEntries = function(entries) {
        const result = {};
        for (const entry of entries) Object.defineProperty(result, entry[0], { value: entry[1], enumerable: true, writable: true, configurable: true });
        return result;
      };
      if (!Array.prototype.flatMap) Object.defineProperty(Array.prototype, "flatMap", { configurable: true, writable: true, value: function(fn, receiver) {
        return this.reduce((result, value, index) => result.concat(fn.call(receiver, value, index, this)), []);
      } });
    }
  });

  // Plus-ins/PSD2UI-CEP/src/hostRpc.js
  var require_hostRpc = __commonJS({
    "Plus-ins/PSD2UI-CEP/src/hostRpc.js"(exports, module) {
      "use strict";
      function errorWithCode(message, code) {
        const error = new Error(message);
        error.code = code;
        return error;
      }
      function requestJson(method, params) {
        if (typeof method !== "string" || !method) throw new TypeError("Photoshop RPC method 不能为空。");
        return JSON.stringify({ method, params: params || {}, deferState: true });
      }
      function inlineScript(json) {
        const literal = JSON.stringify(json).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
        return "$.PSD2UIHost.dispatch(" + literal + ")";
      }
      function scriptForRequest(method, params) {
        return inlineScript(requestJson(method, params));
      }
      function parseResponse(raw) {
        let response;
        try {
          response = JSON.parse(String(raw));
        } catch (error) {
          throw errorWithCode("Photoshop CEP 宿主未返回有效 JSON：" + String(raw).slice(0, 500), "CEP_HOST_RESPONSE_INVALID");
        }
        if (!response || typeof response.ok !== "boolean") {
          throw errorWithCode("Photoshop CEP 宿主响应缺少 ok 字段。", "CEP_HOST_RESPONSE_INVALID");
        }
        return response;
      }
      function prepareRequest(json) {
        if (json.length < 32768) return { script: inlineScript(json), dispose() {
        } };
        const fs = __require("fs"), path = __require("path"), os = __require("os"), crypto = __require("crypto");
        const directory = path.join(os.tmpdir(), "PSD2UI-CEP-rpc");
        try {
          fs.mkdirSync(directory);
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
        const file = path.join(directory, crypto.randomBytes(16).toString("hex") + ".json");
        fs.writeFileSync(file, json, { encoding: "utf8", flag: "wx" });
        return {
          script: "$.PSD2UIHost.dispatchFile(" + JSON.stringify(file.replace(/\\/g, "/")).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029") + ")",
          dispose() {
            try {
              fs.unlinkSync(file);
            } catch (error) {
              if (error.code !== "ENOENT") console.error("CEP 请求临时文件清理失败：", error.message);
            }
          }
        };
      }
      function createHostRpc(options) {
        const configuration = options || {};
        const timeoutMilliseconds = configuration.timeoutMilliseconds == null ? 6e5 : Number(configuration.timeoutMilliseconds);
        if (!(timeoutMilliseconds > 0 && Number.isFinite(timeoutMilliseconds))) {
          throw new TypeError("Photoshop RPC timeoutMilliseconds 必须为正数。");
        }
        let tail = Promise.resolve();
        let uncertain = null;
        function evaluate(script) {
          if (uncertain) return Promise.reject(uncertain);
          const bridge = configuration.evalScript || typeof window !== "undefined" && window.__adobe_cep__ && window.__adobe_cep__.evalScript.bind(window.__adobe_cep__);
          if (typeof bridge !== "function") {
            return Promise.reject(errorWithCode("Photoshop CEP evalScript 接口不可用，请在 Photoshop 中打开 PSD2UI CEP 面板。", "CEP_HOST_UNAVAILABLE"));
          }
          return new Promise((resolve, reject) => {
            let completed = false;
            const timer = setTimeout(() => {
              if (completed) return;
              completed = true;
              uncertain = errorWithCode(
                "Photoshop 宿主调用超时，操作结果未知；未取消或重发操作。请检查 Photoshop 和 PSD 后重新连接。",
                "CEP_HOST_RESULT_UNKNOWN"
              );
              reject(uncertain);
            }, timeoutMilliseconds);
            try {
              bridge(script, (raw) => {
                if (completed) return;
                completed = true;
                clearTimeout(timer);
                try {
                  resolve(parseResponse(raw));
                } catch (error) {
                  uncertain = errorWithCode("Photoshop 返回无法识别的操作结果，结果未知；未重发操作。" + error.message, "CEP_HOST_RESULT_UNKNOWN");
                  reject(uncertain);
                }
              });
            } catch (error) {
              completed = true;
              clearTimeout(timer);
              reject(errorWithCode("Photoshop CEP 调用失败：" + error.message, "CEP_HOST_UNAVAILABLE"));
            }
          });
        }
        return {
          invoke(method, params) {
            let json;
            try {
              json = requestJson(method, params);
            } catch (error) {
              return Promise.reject(error);
            }
            const result = tail.then(async () => {
              if (uncertain) throw uncertain;
              const request = prepareRequest(json);
              try {
                return await evaluate(request.script);
              } finally {
                if (!uncertain) request.dispose();
              }
            });
            tail = result.catch(() => {
            });
            return result;
          },
          isUncertain() {
            return Boolean(uncertain);
          }
        };
      }
      var defaultRpc = createHostRpc();
      module.exports = {
        createHostRpc,
        scriptForRequest,
        parseResponse,
        invoke: defaultRpc.invoke,
        isUncertain: defaultRpc.isUncertain
      };
    }
  });

  // node_modules/pngjs/lib/chunkstream.js
  var require_chunkstream = __commonJS({
    "node_modules/pngjs/lib/chunkstream.js"(exports, module) {
      "use strict";
      var util = __require("util");
      var Stream = __require("stream");
      var ChunkStream = module.exports = function() {
        Stream.call(this);
        this._buffers = [];
        this._buffered = 0;
        this._reads = [];
        this._paused = false;
        this._encoding = "utf8";
        this.writable = true;
      };
      util.inherits(ChunkStream, Stream);
      ChunkStream.prototype.read = function(length, callback) {
        this._reads.push({
          length: Math.abs(length),
          // if length < 0 then at most this length
          allowLess: length < 0,
          func: callback
        });
        process.nextTick(function() {
          this._process();
          if (this._paused && this._reads && this._reads.length > 0) {
            this._paused = false;
            this.emit("drain");
          }
        }.bind(this));
      };
      ChunkStream.prototype.write = function(data, encoding) {
        if (!this.writable) {
          this.emit("error", new Error("Stream not writable"));
          return false;
        }
        var dataBuffer;
        if (Buffer.isBuffer(data)) {
          dataBuffer = data;
        } else {
          dataBuffer = Buffer.from(data, encoding || this._encoding);
        }
        this._buffers.push(dataBuffer);
        this._buffered += dataBuffer.length;
        this._process();
        if (this._reads && this._reads.length === 0) {
          this._paused = true;
        }
        return this.writable && !this._paused;
      };
      ChunkStream.prototype.end = function(data, encoding) {
        if (data) {
          this.write(data, encoding);
        }
        this.writable = false;
        if (!this._buffers) {
          return;
        }
        if (this._buffers.length === 0) {
          this._end();
        } else {
          this._buffers.push(null);
          this._process();
        }
      };
      ChunkStream.prototype.destroySoon = ChunkStream.prototype.end;
      ChunkStream.prototype._end = function() {
        if (this._reads.length > 0) {
          this.emit(
            "error",
            new Error("Unexpected end of input")
          );
        }
        this.destroy();
      };
      ChunkStream.prototype.destroy = function() {
        if (!this._buffers) {
          return;
        }
        this.writable = false;
        this._reads = null;
        this._buffers = null;
        this.emit("close");
      };
      ChunkStream.prototype._processReadAllowingLess = function(read) {
        this._reads.shift();
        var smallerBuf = this._buffers[0];
        if (smallerBuf.length > read.length) {
          this._buffered -= read.length;
          this._buffers[0] = smallerBuf.slice(read.length);
          read.func.call(this, smallerBuf.slice(0, read.length));
        } else {
          this._buffered -= smallerBuf.length;
          this._buffers.shift();
          read.func.call(this, smallerBuf);
        }
      };
      ChunkStream.prototype._processRead = function(read) {
        this._reads.shift();
        var pos = 0;
        var count = 0;
        var data = Buffer.alloc(read.length);
        while (pos < read.length) {
          var buf = this._buffers[count++];
          var len = Math.min(buf.length, read.length - pos);
          buf.copy(data, pos, 0, len);
          pos += len;
          if (len !== buf.length) {
            this._buffers[--count] = buf.slice(len);
          }
        }
        if (count > 0) {
          this._buffers.splice(0, count);
        }
        this._buffered -= read.length;
        read.func.call(this, data);
      };
      ChunkStream.prototype._process = function() {
        try {
          while (this._buffered > 0 && this._reads && this._reads.length > 0) {
            var read = this._reads[0];
            if (read.allowLess) {
              this._processReadAllowingLess(read);
            } else if (this._buffered >= read.length) {
              this._processRead(read);
            } else {
              break;
            }
          }
          if (this._buffers && !this.writable) {
            this._end();
          }
        } catch (ex) {
          this.emit("error", ex);
        }
      };
    }
  });

  // node_modules/pngjs/lib/interlace.js
  var require_interlace = __commonJS({
    "node_modules/pngjs/lib/interlace.js"(exports) {
      "use strict";
      var imagePasses = [
        {
          // pass 1 - 1px
          x: [0],
          y: [0]
        },
        {
          // pass 2 - 1px
          x: [4],
          y: [0]
        },
        {
          // pass 3 - 2px
          x: [0, 4],
          y: [4]
        },
        {
          // pass 4 - 4px
          x: [2, 6],
          y: [0, 4]
        },
        {
          // pass 5 - 8px
          x: [0, 2, 4, 6],
          y: [2, 6]
        },
        {
          // pass 6 - 16px
          x: [1, 3, 5, 7],
          y: [0, 2, 4, 6]
        },
        {
          // pass 7 - 32px
          x: [0, 1, 2, 3, 4, 5, 6, 7],
          y: [1, 3, 5, 7]
        }
      ];
      exports.getImagePasses = function(width, height) {
        var images = [];
        var xLeftOver = width % 8;
        var yLeftOver = height % 8;
        var xRepeats = (width - xLeftOver) / 8;
        var yRepeats = (height - yLeftOver) / 8;
        for (var i = 0; i < imagePasses.length; i++) {
          var pass = imagePasses[i];
          var passWidth = xRepeats * pass.x.length;
          var passHeight = yRepeats * pass.y.length;
          for (var j = 0; j < pass.x.length; j++) {
            if (pass.x[j] < xLeftOver) {
              passWidth++;
            } else {
              break;
            }
          }
          for (j = 0; j < pass.y.length; j++) {
            if (pass.y[j] < yLeftOver) {
              passHeight++;
            } else {
              break;
            }
          }
          if (passWidth > 0 && passHeight > 0) {
            images.push({ width: passWidth, height: passHeight, index: i });
          }
        }
        return images;
      };
      exports.getInterlaceIterator = function(width) {
        return function(x, y, pass) {
          var outerXLeftOver = x % imagePasses[pass].x.length;
          var outerX = (x - outerXLeftOver) / imagePasses[pass].x.length * 8 + imagePasses[pass].x[outerXLeftOver];
          var outerYLeftOver = y % imagePasses[pass].y.length;
          var outerY = (y - outerYLeftOver) / imagePasses[pass].y.length * 8 + imagePasses[pass].y[outerYLeftOver];
          return outerX * 4 + outerY * width * 4;
        };
      };
    }
  });

  // node_modules/pngjs/lib/paeth-predictor.js
  var require_paeth_predictor = __commonJS({
    "node_modules/pngjs/lib/paeth-predictor.js"(exports, module) {
      "use strict";
      module.exports = function paethPredictor(left, above, upLeft) {
        var paeth = left + above - upLeft;
        var pLeft = Math.abs(paeth - left);
        var pAbove = Math.abs(paeth - above);
        var pUpLeft = Math.abs(paeth - upLeft);
        if (pLeft <= pAbove && pLeft <= pUpLeft) {
          return left;
        }
        if (pAbove <= pUpLeft) {
          return above;
        }
        return upLeft;
      };
    }
  });

  // node_modules/pngjs/lib/filter-parse.js
  var require_filter_parse = __commonJS({
    "node_modules/pngjs/lib/filter-parse.js"(exports, module) {
      "use strict";
      var interlaceUtils = require_interlace();
      var paethPredictor = require_paeth_predictor();
      function getByteWidth(width, bpp, depth) {
        var byteWidth = width * bpp;
        if (depth !== 8) {
          byteWidth = Math.ceil(byteWidth / (8 / depth));
        }
        return byteWidth;
      }
      var Filter = module.exports = function(bitmapInfo, dependencies) {
        var width = bitmapInfo.width;
        var height = bitmapInfo.height;
        var interlace = bitmapInfo.interlace;
        var bpp = bitmapInfo.bpp;
        var depth = bitmapInfo.depth;
        this.read = dependencies.read;
        this.write = dependencies.write;
        this.complete = dependencies.complete;
        this._imageIndex = 0;
        this._images = [];
        if (interlace) {
          var passes = interlaceUtils.getImagePasses(width, height);
          for (var i = 0; i < passes.length; i++) {
            this._images.push({
              byteWidth: getByteWidth(passes[i].width, bpp, depth),
              height: passes[i].height,
              lineIndex: 0
            });
          }
        } else {
          this._images.push({
            byteWidth: getByteWidth(width, bpp, depth),
            height,
            lineIndex: 0
          });
        }
        if (depth === 8) {
          this._xComparison = bpp;
        } else if (depth === 16) {
          this._xComparison = bpp * 2;
        } else {
          this._xComparison = 1;
        }
      };
      Filter.prototype.start = function() {
        this.read(this._images[this._imageIndex].byteWidth + 1, this._reverseFilterLine.bind(this));
      };
      Filter.prototype._unFilterType1 = function(rawData, unfilteredLine, byteWidth) {
        var xComparison = this._xComparison;
        var xBiggerThan = xComparison - 1;
        for (var x = 0; x < byteWidth; x++) {
          var rawByte = rawData[1 + x];
          var f1Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
          unfilteredLine[x] = rawByte + f1Left;
        }
      };
      Filter.prototype._unFilterType2 = function(rawData, unfilteredLine, byteWidth) {
        var lastLine = this._lastLine;
        for (var x = 0; x < byteWidth; x++) {
          var rawByte = rawData[1 + x];
          var f2Up = lastLine ? lastLine[x] : 0;
          unfilteredLine[x] = rawByte + f2Up;
        }
      };
      Filter.prototype._unFilterType3 = function(rawData, unfilteredLine, byteWidth) {
        var xComparison = this._xComparison;
        var xBiggerThan = xComparison - 1;
        var lastLine = this._lastLine;
        for (var x = 0; x < byteWidth; x++) {
          var rawByte = rawData[1 + x];
          var f3Up = lastLine ? lastLine[x] : 0;
          var f3Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
          var f3Add = Math.floor((f3Left + f3Up) / 2);
          unfilteredLine[x] = rawByte + f3Add;
        }
      };
      Filter.prototype._unFilterType4 = function(rawData, unfilteredLine, byteWidth) {
        var xComparison = this._xComparison;
        var xBiggerThan = xComparison - 1;
        var lastLine = this._lastLine;
        for (var x = 0; x < byteWidth; x++) {
          var rawByte = rawData[1 + x];
          var f4Up = lastLine ? lastLine[x] : 0;
          var f4Left = x > xBiggerThan ? unfilteredLine[x - xComparison] : 0;
          var f4UpLeft = x > xBiggerThan && lastLine ? lastLine[x - xComparison] : 0;
          var f4Add = paethPredictor(f4Left, f4Up, f4UpLeft);
          unfilteredLine[x] = rawByte + f4Add;
        }
      };
      Filter.prototype._reverseFilterLine = function(rawData) {
        var filter = rawData[0];
        var unfilteredLine;
        var currentImage = this._images[this._imageIndex];
        var byteWidth = currentImage.byteWidth;
        if (filter === 0) {
          unfilteredLine = rawData.slice(1, byteWidth + 1);
        } else {
          unfilteredLine = Buffer.alloc(byteWidth);
          switch (filter) {
            case 1:
              this._unFilterType1(rawData, unfilteredLine, byteWidth);
              break;
            case 2:
              this._unFilterType2(rawData, unfilteredLine, byteWidth);
              break;
            case 3:
              this._unFilterType3(rawData, unfilteredLine, byteWidth);
              break;
            case 4:
              this._unFilterType4(rawData, unfilteredLine, byteWidth);
              break;
            default:
              throw new Error("Unrecognised filter type - " + filter);
          }
        }
        this.write(unfilteredLine);
        currentImage.lineIndex++;
        if (currentImage.lineIndex >= currentImage.height) {
          this._lastLine = null;
          this._imageIndex++;
          currentImage = this._images[this._imageIndex];
        } else {
          this._lastLine = unfilteredLine;
        }
        if (currentImage) {
          this.read(currentImage.byteWidth + 1, this._reverseFilterLine.bind(this));
        } else {
          this._lastLine = null;
          this.complete();
        }
      };
    }
  });

  // node_modules/pngjs/lib/filter-parse-async.js
  var require_filter_parse_async = __commonJS({
    "node_modules/pngjs/lib/filter-parse-async.js"(exports, module) {
      "use strict";
      var util = __require("util");
      var ChunkStream = require_chunkstream();
      var Filter = require_filter_parse();
      var FilterAsync = module.exports = function(bitmapInfo) {
        ChunkStream.call(this);
        var buffers = [];
        var that = this;
        this._filter = new Filter(bitmapInfo, {
          read: this.read.bind(this),
          write: function(buffer) {
            buffers.push(buffer);
          },
          complete: function() {
            that.emit("complete", Buffer.concat(buffers));
          }
        });
        this._filter.start();
      };
      util.inherits(FilterAsync, ChunkStream);
    }
  });

  // node_modules/pngjs/lib/constants.js
  var require_constants = __commonJS({
    "node_modules/pngjs/lib/constants.js"(exports, module) {
      "use strict";
      module.exports = {
        PNG_SIGNATURE: [137, 80, 78, 71, 13, 10, 26, 10],
        TYPE_IHDR: 1229472850,
        TYPE_IEND: 1229278788,
        TYPE_IDAT: 1229209940,
        TYPE_PLTE: 1347179589,
        TYPE_tRNS: 1951551059,
        // eslint-disable-line camelcase
        TYPE_gAMA: 1732332865,
        // eslint-disable-line camelcase
        // color-type bits
        COLORTYPE_GRAYSCALE: 0,
        COLORTYPE_PALETTE: 1,
        COLORTYPE_COLOR: 2,
        COLORTYPE_ALPHA: 4,
        // e.g. grayscale and alpha
        // color-type combinations
        COLORTYPE_PALETTE_COLOR: 3,
        COLORTYPE_COLOR_ALPHA: 6,
        COLORTYPE_TO_BPP_MAP: {
          0: 1,
          2: 3,
          3: 1,
          4: 2,
          6: 4
        },
        GAMMA_DIVISION: 1e5
      };
    }
  });

  // node_modules/pngjs/lib/crc.js
  var require_crc = __commonJS({
    "node_modules/pngjs/lib/crc.js"(exports, module) {
      "use strict";
      var crcTable = [];
      (function() {
        for (var i = 0; i < 256; i++) {
          var currentCrc = i;
          for (var j = 0; j < 8; j++) {
            if (currentCrc & 1) {
              currentCrc = 3988292384 ^ currentCrc >>> 1;
            } else {
              currentCrc = currentCrc >>> 1;
            }
          }
          crcTable[i] = currentCrc;
        }
      })();
      var CrcCalculator = module.exports = function() {
        this._crc = -1;
      };
      CrcCalculator.prototype.write = function(data) {
        for (var i = 0; i < data.length; i++) {
          this._crc = crcTable[(this._crc ^ data[i]) & 255] ^ this._crc >>> 8;
        }
        return true;
      };
      CrcCalculator.prototype.crc32 = function() {
        return this._crc ^ -1;
      };
      CrcCalculator.crc32 = function(buf) {
        var crc = -1;
        for (var i = 0; i < buf.length; i++) {
          crc = crcTable[(crc ^ buf[i]) & 255] ^ crc >>> 8;
        }
        return crc ^ -1;
      };
    }
  });

  // node_modules/pngjs/lib/parser.js
  var require_parser = __commonJS({
    "node_modules/pngjs/lib/parser.js"(exports, module) {
      "use strict";
      var constants = require_constants();
      var CrcCalculator = require_crc();
      var Parser = module.exports = function(options, dependencies) {
        this._options = options;
        options.checkCRC = options.checkCRC !== false;
        this._hasIHDR = false;
        this._hasIEND = false;
        this._emittedHeadersFinished = false;
        this._palette = [];
        this._colorType = 0;
        this._chunks = {};
        this._chunks[constants.TYPE_IHDR] = this._handleIHDR.bind(this);
        this._chunks[constants.TYPE_IEND] = this._handleIEND.bind(this);
        this._chunks[constants.TYPE_IDAT] = this._handleIDAT.bind(this);
        this._chunks[constants.TYPE_PLTE] = this._handlePLTE.bind(this);
        this._chunks[constants.TYPE_tRNS] = this._handleTRNS.bind(this);
        this._chunks[constants.TYPE_gAMA] = this._handleGAMA.bind(this);
        this.read = dependencies.read;
        this.error = dependencies.error;
        this.metadata = dependencies.metadata;
        this.gamma = dependencies.gamma;
        this.transColor = dependencies.transColor;
        this.palette = dependencies.palette;
        this.parsed = dependencies.parsed;
        this.inflateData = dependencies.inflateData;
        this.finished = dependencies.finished;
        this.simpleTransparency = dependencies.simpleTransparency;
        this.headersFinished = dependencies.headersFinished || function() {
        };
      };
      Parser.prototype.start = function() {
        this.read(
          constants.PNG_SIGNATURE.length,
          this._parseSignature.bind(this)
        );
      };
      Parser.prototype._parseSignature = function(data) {
        var signature = constants.PNG_SIGNATURE;
        for (var i = 0; i < signature.length; i++) {
          if (data[i] !== signature[i]) {
            this.error(new Error("Invalid file signature"));
            return;
          }
        }
        this.read(8, this._parseChunkBegin.bind(this));
      };
      Parser.prototype._parseChunkBegin = function(data) {
        var length = data.readUInt32BE(0);
        var type = data.readUInt32BE(4);
        var name = "";
        for (var i = 4; i < 8; i++) {
          name += String.fromCharCode(data[i]);
        }
        var ancillary = Boolean(data[4] & 32);
        if (!this._hasIHDR && type !== constants.TYPE_IHDR) {
          this.error(new Error("Expected IHDR on beggining"));
          return;
        }
        this._crc = new CrcCalculator();
        this._crc.write(Buffer.from(name));
        if (this._chunks[type]) {
          return this._chunks[type](length);
        }
        if (!ancillary) {
          this.error(new Error("Unsupported critical chunk type " + name));
          return;
        }
        this.read(length + 4, this._skipChunk.bind(this));
      };
      Parser.prototype._skipChunk = function() {
        this.read(8, this._parseChunkBegin.bind(this));
      };
      Parser.prototype._handleChunkEnd = function() {
        this.read(4, this._parseChunkEnd.bind(this));
      };
      Parser.prototype._parseChunkEnd = function(data) {
        var fileCrc = data.readInt32BE(0);
        var calcCrc = this._crc.crc32();
        if (this._options.checkCRC && calcCrc !== fileCrc) {
          this.error(new Error("Crc error - " + fileCrc + " - " + calcCrc));
          return;
        }
        if (!this._hasIEND) {
          this.read(8, this._parseChunkBegin.bind(this));
        }
      };
      Parser.prototype._handleIHDR = function(length) {
        this.read(length, this._parseIHDR.bind(this));
      };
      Parser.prototype._parseIHDR = function(data) {
        this._crc.write(data);
        var width = data.readUInt32BE(0);
        var height = data.readUInt32BE(4);
        var depth = data[8];
        var colorType = data[9];
        var compr = data[10];
        var filter = data[11];
        var interlace = data[12];
        if (depth !== 8 && depth !== 4 && depth !== 2 && depth !== 1 && depth !== 16) {
          this.error(new Error("Unsupported bit depth " + depth));
          return;
        }
        if (!(colorType in constants.COLORTYPE_TO_BPP_MAP)) {
          this.error(new Error("Unsupported color type"));
          return;
        }
        if (compr !== 0) {
          this.error(new Error("Unsupported compression method"));
          return;
        }
        if (filter !== 0) {
          this.error(new Error("Unsupported filter method"));
          return;
        }
        if (interlace !== 0 && interlace !== 1) {
          this.error(new Error("Unsupported interlace method"));
          return;
        }
        this._colorType = colorType;
        var bpp = constants.COLORTYPE_TO_BPP_MAP[this._colorType];
        this._hasIHDR = true;
        this.metadata({
          width,
          height,
          depth,
          interlace: Boolean(interlace),
          palette: Boolean(colorType & constants.COLORTYPE_PALETTE),
          color: Boolean(colorType & constants.COLORTYPE_COLOR),
          alpha: Boolean(colorType & constants.COLORTYPE_ALPHA),
          bpp,
          colorType
        });
        this._handleChunkEnd();
      };
      Parser.prototype._handlePLTE = function(length) {
        this.read(length, this._parsePLTE.bind(this));
      };
      Parser.prototype._parsePLTE = function(data) {
        this._crc.write(data);
        var entries = Math.floor(data.length / 3);
        for (var i = 0; i < entries; i++) {
          this._palette.push([
            data[i * 3],
            data[i * 3 + 1],
            data[i * 3 + 2],
            255
          ]);
        }
        this.palette(this._palette);
        this._handleChunkEnd();
      };
      Parser.prototype._handleTRNS = function(length) {
        this.simpleTransparency();
        this.read(length, this._parseTRNS.bind(this));
      };
      Parser.prototype._parseTRNS = function(data) {
        this._crc.write(data);
        if (this._colorType === constants.COLORTYPE_PALETTE_COLOR) {
          if (this._palette.length === 0) {
            this.error(new Error("Transparency chunk must be after palette"));
            return;
          }
          if (data.length > this._palette.length) {
            this.error(new Error("More transparent colors than palette size"));
            return;
          }
          for (var i = 0; i < data.length; i++) {
            this._palette[i][3] = data[i];
          }
          this.palette(this._palette);
        }
        if (this._colorType === constants.COLORTYPE_GRAYSCALE) {
          this.transColor([data.readUInt16BE(0)]);
        }
        if (this._colorType === constants.COLORTYPE_COLOR) {
          this.transColor([data.readUInt16BE(0), data.readUInt16BE(2), data.readUInt16BE(4)]);
        }
        this._handleChunkEnd();
      };
      Parser.prototype._handleGAMA = function(length) {
        this.read(length, this._parseGAMA.bind(this));
      };
      Parser.prototype._parseGAMA = function(data) {
        this._crc.write(data);
        this.gamma(data.readUInt32BE(0) / constants.GAMMA_DIVISION);
        this._handleChunkEnd();
      };
      Parser.prototype._handleIDAT = function(length) {
        if (!this._emittedHeadersFinished) {
          this._emittedHeadersFinished = true;
          this.headersFinished();
        }
        this.read(-length, this._parseIDAT.bind(this, length));
      };
      Parser.prototype._parseIDAT = function(length, data) {
        this._crc.write(data);
        if (this._colorType === constants.COLORTYPE_PALETTE_COLOR && this._palette.length === 0) {
          throw new Error("Expected palette not found");
        }
        this.inflateData(data);
        var leftOverLength = length - data.length;
        if (leftOverLength > 0) {
          this._handleIDAT(leftOverLength);
        } else {
          this._handleChunkEnd();
        }
      };
      Parser.prototype._handleIEND = function(length) {
        this.read(length, this._parseIEND.bind(this));
      };
      Parser.prototype._parseIEND = function(data) {
        this._crc.write(data);
        this._hasIEND = true;
        this._handleChunkEnd();
        if (this.finished) {
          this.finished();
        }
      };
    }
  });

  // node_modules/pngjs/lib/bitmapper.js
  var require_bitmapper = __commonJS({
    "node_modules/pngjs/lib/bitmapper.js"(exports) {
      "use strict";
      var interlaceUtils = require_interlace();
      var pixelBppMapper = [
        // 0 - dummy entry
        function() {
        },
        // 1 - L
        // 0: 0, 1: 0, 2: 0, 3: 0xff
        function(pxData, data, pxPos, rawPos) {
          if (rawPos === data.length) {
            throw new Error("Ran out of data");
          }
          var pixel = data[rawPos];
          pxData[pxPos] = pixel;
          pxData[pxPos + 1] = pixel;
          pxData[pxPos + 2] = pixel;
          pxData[pxPos + 3] = 255;
        },
        // 2 - LA
        // 0: 0, 1: 0, 2: 0, 3: 1
        function(pxData, data, pxPos, rawPos) {
          if (rawPos + 1 >= data.length) {
            throw new Error("Ran out of data");
          }
          var pixel = data[rawPos];
          pxData[pxPos] = pixel;
          pxData[pxPos + 1] = pixel;
          pxData[pxPos + 2] = pixel;
          pxData[pxPos + 3] = data[rawPos + 1];
        },
        // 3 - RGB
        // 0: 0, 1: 1, 2: 2, 3: 0xff
        function(pxData, data, pxPos, rawPos) {
          if (rawPos + 2 >= data.length) {
            throw new Error("Ran out of data");
          }
          pxData[pxPos] = data[rawPos];
          pxData[pxPos + 1] = data[rawPos + 1];
          pxData[pxPos + 2] = data[rawPos + 2];
          pxData[pxPos + 3] = 255;
        },
        // 4 - RGBA
        // 0: 0, 1: 1, 2: 2, 3: 3
        function(pxData, data, pxPos, rawPos) {
          if (rawPos + 3 >= data.length) {
            throw new Error("Ran out of data");
          }
          pxData[pxPos] = data[rawPos];
          pxData[pxPos + 1] = data[rawPos + 1];
          pxData[pxPos + 2] = data[rawPos + 2];
          pxData[pxPos + 3] = data[rawPos + 3];
        }
      ];
      var pixelBppCustomMapper = [
        // 0 - dummy entry
        function() {
        },
        // 1 - L
        // 0: 0, 1: 0, 2: 0, 3: 0xff
        function(pxData, pixelData, pxPos, maxBit) {
          var pixel = pixelData[0];
          pxData[pxPos] = pixel;
          pxData[pxPos + 1] = pixel;
          pxData[pxPos + 2] = pixel;
          pxData[pxPos + 3] = maxBit;
        },
        // 2 - LA
        // 0: 0, 1: 0, 2: 0, 3: 1
        function(pxData, pixelData, pxPos) {
          var pixel = pixelData[0];
          pxData[pxPos] = pixel;
          pxData[pxPos + 1] = pixel;
          pxData[pxPos + 2] = pixel;
          pxData[pxPos + 3] = pixelData[1];
        },
        // 3 - RGB
        // 0: 0, 1: 1, 2: 2, 3: 0xff
        function(pxData, pixelData, pxPos, maxBit) {
          pxData[pxPos] = pixelData[0];
          pxData[pxPos + 1] = pixelData[1];
          pxData[pxPos + 2] = pixelData[2];
          pxData[pxPos + 3] = maxBit;
        },
        // 4 - RGBA
        // 0: 0, 1: 1, 2: 2, 3: 3
        function(pxData, pixelData, pxPos) {
          pxData[pxPos] = pixelData[0];
          pxData[pxPos + 1] = pixelData[1];
          pxData[pxPos + 2] = pixelData[2];
          pxData[pxPos + 3] = pixelData[3];
        }
      ];
      function bitRetriever(data, depth) {
        var leftOver = [];
        var i = 0;
        function split() {
          if (i === data.length) {
            throw new Error("Ran out of data");
          }
          var byte = data[i];
          i++;
          var byte8, byte7, byte6, byte5, byte4, byte3, byte2, byte1;
          switch (depth) {
            default:
              throw new Error("unrecognised depth");
            case 16:
              byte2 = data[i];
              i++;
              leftOver.push((byte << 8) + byte2);
              break;
            case 4:
              byte2 = byte & 15;
              byte1 = byte >> 4;
              leftOver.push(byte1, byte2);
              break;
            case 2:
              byte4 = byte & 3;
              byte3 = byte >> 2 & 3;
              byte2 = byte >> 4 & 3;
              byte1 = byte >> 6 & 3;
              leftOver.push(byte1, byte2, byte3, byte4);
              break;
            case 1:
              byte8 = byte & 1;
              byte7 = byte >> 1 & 1;
              byte6 = byte >> 2 & 1;
              byte5 = byte >> 3 & 1;
              byte4 = byte >> 4 & 1;
              byte3 = byte >> 5 & 1;
              byte2 = byte >> 6 & 1;
              byte1 = byte >> 7 & 1;
              leftOver.push(byte1, byte2, byte3, byte4, byte5, byte6, byte7, byte8);
              break;
          }
        }
        return {
          get: function(count) {
            while (leftOver.length < count) {
              split();
            }
            var returner = leftOver.slice(0, count);
            leftOver = leftOver.slice(count);
            return returner;
          },
          resetAfterLine: function() {
            leftOver.length = 0;
          },
          end: function() {
            if (i !== data.length) {
              throw new Error("extra data found");
            }
          }
        };
      }
      function mapImage8Bit(image, pxData, getPxPos, bpp, data, rawPos) {
        var imageWidth = image.width;
        var imageHeight = image.height;
        var imagePass = image.index;
        for (var y = 0; y < imageHeight; y++) {
          for (var x = 0; x < imageWidth; x++) {
            var pxPos = getPxPos(x, y, imagePass);
            pixelBppMapper[bpp](pxData, data, pxPos, rawPos);
            rawPos += bpp;
          }
        }
        return rawPos;
      }
      function mapImageCustomBit(image, pxData, getPxPos, bpp, bits, maxBit) {
        var imageWidth = image.width;
        var imageHeight = image.height;
        var imagePass = image.index;
        for (var y = 0; y < imageHeight; y++) {
          for (var x = 0; x < imageWidth; x++) {
            var pixelData = bits.get(bpp);
            var pxPos = getPxPos(x, y, imagePass);
            pixelBppCustomMapper[bpp](pxData, pixelData, pxPos, maxBit);
          }
          bits.resetAfterLine();
        }
      }
      exports.dataToBitMap = function(data, bitmapInfo) {
        var width = bitmapInfo.width;
        var height = bitmapInfo.height;
        var depth = bitmapInfo.depth;
        var bpp = bitmapInfo.bpp;
        var interlace = bitmapInfo.interlace;
        if (depth !== 8) {
          var bits = bitRetriever(data, depth);
        }
        var pxData;
        if (depth <= 8) {
          pxData = Buffer.alloc(width * height * 4);
        } else {
          pxData = new Uint16Array(width * height * 4);
        }
        var maxBit = Math.pow(2, depth) - 1;
        var rawPos = 0;
        var images;
        var getPxPos;
        if (interlace) {
          images = interlaceUtils.getImagePasses(width, height);
          getPxPos = interlaceUtils.getInterlaceIterator(width, height);
        } else {
          var nonInterlacedPxPos = 0;
          getPxPos = function() {
            var returner = nonInterlacedPxPos;
            nonInterlacedPxPos += 4;
            return returner;
          };
          images = [{ width, height }];
        }
        for (var imageIndex = 0; imageIndex < images.length; imageIndex++) {
          if (depth === 8) {
            rawPos = mapImage8Bit(images[imageIndex], pxData, getPxPos, bpp, data, rawPos);
          } else {
            mapImageCustomBit(images[imageIndex], pxData, getPxPos, bpp, bits, maxBit);
          }
        }
        if (depth === 8) {
          if (rawPos !== data.length) {
            throw new Error("extra data found");
          }
        } else {
          bits.end();
        }
        return pxData;
      };
    }
  });

  // node_modules/pngjs/lib/format-normaliser.js
  var require_format_normaliser = __commonJS({
    "node_modules/pngjs/lib/format-normaliser.js"(exports, module) {
      "use strict";
      function dePalette(indata, outdata, width, height, palette) {
        var pxPos = 0;
        for (var y = 0; y < height; y++) {
          for (var x = 0; x < width; x++) {
            var color = palette[indata[pxPos]];
            if (!color) {
              throw new Error("index " + indata[pxPos] + " not in palette");
            }
            for (var i = 0; i < 4; i++) {
              outdata[pxPos + i] = color[i];
            }
            pxPos += 4;
          }
        }
      }
      function replaceTransparentColor(indata, outdata, width, height, transColor) {
        var pxPos = 0;
        for (var y = 0; y < height; y++) {
          for (var x = 0; x < width; x++) {
            var makeTrans = false;
            if (transColor.length === 1) {
              if (transColor[0] === indata[pxPos]) {
                makeTrans = true;
              }
            } else if (transColor[0] === indata[pxPos] && transColor[1] === indata[pxPos + 1] && transColor[2] === indata[pxPos + 2]) {
              makeTrans = true;
            }
            if (makeTrans) {
              for (var i = 0; i < 4; i++) {
                outdata[pxPos + i] = 0;
              }
            }
            pxPos += 4;
          }
        }
      }
      function scaleDepth(indata, outdata, width, height, depth) {
        var maxOutSample = 255;
        var maxInSample = Math.pow(2, depth) - 1;
        var pxPos = 0;
        for (var y = 0; y < height; y++) {
          for (var x = 0; x < width; x++) {
            for (var i = 0; i < 4; i++) {
              outdata[pxPos + i] = Math.floor(indata[pxPos + i] * maxOutSample / maxInSample + 0.5);
            }
            pxPos += 4;
          }
        }
      }
      module.exports = function(indata, imageData) {
        var depth = imageData.depth;
        var width = imageData.width;
        var height = imageData.height;
        var colorType = imageData.colorType;
        var transColor = imageData.transColor;
        var palette = imageData.palette;
        var outdata = indata;
        if (colorType === 3) {
          dePalette(indata, outdata, width, height, palette);
        } else {
          if (transColor) {
            replaceTransparentColor(indata, outdata, width, height, transColor);
          }
          if (depth !== 8) {
            if (depth === 16) {
              outdata = Buffer.alloc(width * height * 4);
            }
            scaleDepth(indata, outdata, width, height, depth);
          }
        }
        return outdata;
      };
    }
  });

  // node_modules/pngjs/lib/parser-async.js
  var require_parser_async = __commonJS({
    "node_modules/pngjs/lib/parser-async.js"(exports, module) {
      "use strict";
      var util = __require("util");
      var zlib = __require("zlib");
      var ChunkStream = require_chunkstream();
      var FilterAsync = require_filter_parse_async();
      var Parser = require_parser();
      var bitmapper = require_bitmapper();
      var formatNormaliser = require_format_normaliser();
      var ParserAsync = module.exports = function(options) {
        ChunkStream.call(this);
        this._parser = new Parser(options, {
          read: this.read.bind(this),
          error: this._handleError.bind(this),
          metadata: this._handleMetaData.bind(this),
          gamma: this.emit.bind(this, "gamma"),
          palette: this._handlePalette.bind(this),
          transColor: this._handleTransColor.bind(this),
          finished: this._finished.bind(this),
          inflateData: this._inflateData.bind(this),
          simpleTransparency: this._simpleTransparency.bind(this),
          headersFinished: this._headersFinished.bind(this)
        });
        this._options = options;
        this.writable = true;
        this._parser.start();
      };
      util.inherits(ParserAsync, ChunkStream);
      ParserAsync.prototype._handleError = function(err) {
        this.emit("error", err);
        this.writable = false;
        this.destroy();
        if (this._inflate && this._inflate.destroy) {
          this._inflate.destroy();
        }
        if (this._filter) {
          this._filter.destroy();
          this._filter.on("error", function() {
          });
        }
        this.errord = true;
      };
      ParserAsync.prototype._inflateData = function(data) {
        if (!this._inflate) {
          if (this._bitmapInfo.interlace) {
            this._inflate = zlib.createInflate();
            this._inflate.on("error", this.emit.bind(this, "error"));
            this._filter.on("complete", this._complete.bind(this));
            this._inflate.pipe(this._filter);
          } else {
            var rowSize = (this._bitmapInfo.width * this._bitmapInfo.bpp * this._bitmapInfo.depth + 7 >> 3) + 1;
            var imageSize = rowSize * this._bitmapInfo.height;
            var chunkSize = Math.max(imageSize, zlib.Z_MIN_CHUNK);
            this._inflate = zlib.createInflate({ chunkSize });
            var leftToInflate = imageSize;
            var emitError = this.emit.bind(this, "error");
            this._inflate.on("error", function(err) {
              if (!leftToInflate) {
                return;
              }
              emitError(err);
            });
            this._filter.on("complete", this._complete.bind(this));
            var filterWrite = this._filter.write.bind(this._filter);
            this._inflate.on("data", function(chunk) {
              if (!leftToInflate) {
                return;
              }
              if (chunk.length > leftToInflate) {
                chunk = chunk.slice(0, leftToInflate);
              }
              leftToInflate -= chunk.length;
              filterWrite(chunk);
            });
            this._inflate.on("end", this._filter.end.bind(this._filter));
          }
        }
        this._inflate.write(data);
      };
      ParserAsync.prototype._handleMetaData = function(metaData) {
        this._metaData = metaData;
        this._bitmapInfo = Object.create(metaData);
        this._filter = new FilterAsync(this._bitmapInfo);
      };
      ParserAsync.prototype._handleTransColor = function(transColor) {
        this._bitmapInfo.transColor = transColor;
      };
      ParserAsync.prototype._handlePalette = function(palette) {
        this._bitmapInfo.palette = palette;
      };
      ParserAsync.prototype._simpleTransparency = function() {
        this._metaData.alpha = true;
      };
      ParserAsync.prototype._headersFinished = function() {
        this.emit("metadata", this._metaData);
      };
      ParserAsync.prototype._finished = function() {
        if (this.errord) {
          return;
        }
        if (!this._inflate) {
          this.emit("error", "No Inflate block");
        } else {
          this._inflate.end();
        }
      };
      ParserAsync.prototype._complete = function(filteredData) {
        if (this.errord) {
          return;
        }
        try {
          var bitmapData = bitmapper.dataToBitMap(filteredData, this._bitmapInfo);
          var normalisedBitmapData = formatNormaliser(bitmapData, this._bitmapInfo);
          bitmapData = null;
        } catch (ex) {
          this._handleError(ex);
          return;
        }
        this.emit("parsed", normalisedBitmapData);
      };
    }
  });

  // node_modules/pngjs/lib/bitpacker.js
  var require_bitpacker = __commonJS({
    "node_modules/pngjs/lib/bitpacker.js"(exports, module) {
      "use strict";
      var constants = require_constants();
      module.exports = function(dataIn, width, height, options) {
        var outHasAlpha = [constants.COLORTYPE_COLOR_ALPHA, constants.COLORTYPE_ALPHA].indexOf(options.colorType) !== -1;
        if (options.colorType === options.inputColorType) {
          var bigEndian = (function() {
            var buffer = new ArrayBuffer(2);
            new DataView(buffer).setInt16(
              0,
              256,
              true
              /* littleEndian */
            );
            return new Int16Array(buffer)[0] !== 256;
          })();
          if (options.bitDepth === 8 || options.bitDepth === 16 && bigEndian) {
            return dataIn;
          }
        }
        var data = options.bitDepth !== 16 ? dataIn : new Uint16Array(dataIn.buffer);
        var maxValue = 255;
        var inBpp = constants.COLORTYPE_TO_BPP_MAP[options.inputColorType];
        if (inBpp === 4 && !options.inputHasAlpha) {
          inBpp = 3;
        }
        var outBpp = constants.COLORTYPE_TO_BPP_MAP[options.colorType];
        if (options.bitDepth === 16) {
          maxValue = 65535;
          outBpp *= 2;
        }
        var outData = Buffer.alloc(width * height * outBpp);
        var inIndex = 0;
        var outIndex = 0;
        var bgColor = options.bgColor || {};
        if (bgColor.red === void 0) {
          bgColor.red = maxValue;
        }
        if (bgColor.green === void 0) {
          bgColor.green = maxValue;
        }
        if (bgColor.blue === void 0) {
          bgColor.blue = maxValue;
        }
        function getRGBA() {
          var red;
          var green;
          var blue;
          var alpha = maxValue;
          switch (options.inputColorType) {
            case constants.COLORTYPE_COLOR_ALPHA:
              alpha = data[inIndex + 3];
              red = data[inIndex];
              green = data[inIndex + 1];
              blue = data[inIndex + 2];
              break;
            case constants.COLORTYPE_COLOR:
              red = data[inIndex];
              green = data[inIndex + 1];
              blue = data[inIndex + 2];
              break;
            case constants.COLORTYPE_ALPHA:
              alpha = data[inIndex + 1];
              red = data[inIndex];
              green = red;
              blue = red;
              break;
            case constants.COLORTYPE_GRAYSCALE:
              red = data[inIndex];
              green = red;
              blue = red;
              break;
            default:
              throw new Error("input color type:" + options.inputColorType + " is not supported at present");
          }
          if (options.inputHasAlpha) {
            if (!outHasAlpha) {
              alpha /= maxValue;
              red = Math.min(Math.max(Math.round((1 - alpha) * bgColor.red + alpha * red), 0), maxValue);
              green = Math.min(Math.max(Math.round((1 - alpha) * bgColor.green + alpha * green), 0), maxValue);
              blue = Math.min(Math.max(Math.round((1 - alpha) * bgColor.blue + alpha * blue), 0), maxValue);
            }
          }
          return { red, green, blue, alpha };
        }
        for (var y = 0; y < height; y++) {
          for (var x = 0; x < width; x++) {
            var rgba = getRGBA(data, inIndex);
            switch (options.colorType) {
              case constants.COLORTYPE_COLOR_ALPHA:
              case constants.COLORTYPE_COLOR:
                if (options.bitDepth === 8) {
                  outData[outIndex] = rgba.red;
                  outData[outIndex + 1] = rgba.green;
                  outData[outIndex + 2] = rgba.blue;
                  if (outHasAlpha) {
                    outData[outIndex + 3] = rgba.alpha;
                  }
                } else {
                  outData.writeUInt16BE(rgba.red, outIndex);
                  outData.writeUInt16BE(rgba.green, outIndex + 2);
                  outData.writeUInt16BE(rgba.blue, outIndex + 4);
                  if (outHasAlpha) {
                    outData.writeUInt16BE(rgba.alpha, outIndex + 6);
                  }
                }
                break;
              case constants.COLORTYPE_ALPHA:
              case constants.COLORTYPE_GRAYSCALE:
                var grayscale = (rgba.red + rgba.green + rgba.blue) / 3;
                if (options.bitDepth === 8) {
                  outData[outIndex] = grayscale;
                  if (outHasAlpha) {
                    outData[outIndex + 1] = rgba.alpha;
                  }
                } else {
                  outData.writeUInt16BE(grayscale, outIndex);
                  if (outHasAlpha) {
                    outData.writeUInt16BE(rgba.alpha, outIndex + 2);
                  }
                }
                break;
              default:
                throw new Error("unrecognised color Type " + options.colorType);
            }
            inIndex += inBpp;
            outIndex += outBpp;
          }
        }
        return outData;
      };
    }
  });

  // node_modules/pngjs/lib/filter-pack.js
  var require_filter_pack = __commonJS({
    "node_modules/pngjs/lib/filter-pack.js"(exports, module) {
      "use strict";
      var paethPredictor = require_paeth_predictor();
      function filterNone(pxData, pxPos, byteWidth, rawData, rawPos) {
        for (var x = 0; x < byteWidth; x++) {
          rawData[rawPos + x] = pxData[pxPos + x];
        }
      }
      function filterSumNone(pxData, pxPos, byteWidth) {
        var sum = 0;
        var length = pxPos + byteWidth;
        for (var i = pxPos; i < length; i++) {
          sum += Math.abs(pxData[i]);
        }
        return sum;
      }
      function filterSub(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
        for (var x = 0; x < byteWidth; x++) {
          var left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
          var val = pxData[pxPos + x] - left;
          rawData[rawPos + x] = val;
        }
      }
      function filterSumSub(pxData, pxPos, byteWidth, bpp) {
        var sum = 0;
        for (var x = 0; x < byteWidth; x++) {
          var left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
          var val = pxData[pxPos + x] - left;
          sum += Math.abs(val);
        }
        return sum;
      }
      function filterUp(pxData, pxPos, byteWidth, rawData, rawPos) {
        for (var x = 0; x < byteWidth; x++) {
          var up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
          var val = pxData[pxPos + x] - up;
          rawData[rawPos + x] = val;
        }
      }
      function filterSumUp(pxData, pxPos, byteWidth) {
        var sum = 0;
        var length = pxPos + byteWidth;
        for (var x = pxPos; x < length; x++) {
          var up = pxPos > 0 ? pxData[x - byteWidth] : 0;
          var val = pxData[x] - up;
          sum += Math.abs(val);
        }
        return sum;
      }
      function filterAvg(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
        for (var x = 0; x < byteWidth; x++) {
          var left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
          var up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
          var val = pxData[pxPos + x] - (left + up >> 1);
          rawData[rawPos + x] = val;
        }
      }
      function filterSumAvg(pxData, pxPos, byteWidth, bpp) {
        var sum = 0;
        for (var x = 0; x < byteWidth; x++) {
          var left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
          var up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
          var val = pxData[pxPos + x] - (left + up >> 1);
          sum += Math.abs(val);
        }
        return sum;
      }
      function filterPaeth(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
        for (var x = 0; x < byteWidth; x++) {
          var left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
          var up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
          var upleft = pxPos > 0 && x >= bpp ? pxData[pxPos + x - (byteWidth + bpp)] : 0;
          var val = pxData[pxPos + x] - paethPredictor(left, up, upleft);
          rawData[rawPos + x] = val;
        }
      }
      function filterSumPaeth(pxData, pxPos, byteWidth, bpp) {
        var sum = 0;
        for (var x = 0; x < byteWidth; x++) {
          var left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
          var up = pxPos > 0 ? pxData[pxPos + x - byteWidth] : 0;
          var upleft = pxPos > 0 && x >= bpp ? pxData[pxPos + x - (byteWidth + bpp)] : 0;
          var val = pxData[pxPos + x] - paethPredictor(left, up, upleft);
          sum += Math.abs(val);
        }
        return sum;
      }
      var filters = {
        0: filterNone,
        1: filterSub,
        2: filterUp,
        3: filterAvg,
        4: filterPaeth
      };
      var filterSums = {
        0: filterSumNone,
        1: filterSumSub,
        2: filterSumUp,
        3: filterSumAvg,
        4: filterSumPaeth
      };
      module.exports = function(pxData, width, height, options, bpp) {
        var filterTypes;
        if (!("filterType" in options) || options.filterType === -1) {
          filterTypes = [0, 1, 2, 3, 4];
        } else if (typeof options.filterType === "number") {
          filterTypes = [options.filterType];
        } else {
          throw new Error("unrecognised filter types");
        }
        if (options.bitDepth === 16) {
          bpp *= 2;
        }
        var byteWidth = width * bpp;
        var rawPos = 0;
        var pxPos = 0;
        var rawData = Buffer.alloc((byteWidth + 1) * height);
        var sel = filterTypes[0];
        for (var y = 0; y < height; y++) {
          if (filterTypes.length > 1) {
            var min = Infinity;
            for (var i = 0; i < filterTypes.length; i++) {
              var sum = filterSums[filterTypes[i]](pxData, pxPos, byteWidth, bpp);
              if (sum < min) {
                sel = filterTypes[i];
                min = sum;
              }
            }
          }
          rawData[rawPos] = sel;
          rawPos++;
          filters[sel](pxData, pxPos, byteWidth, rawData, rawPos, bpp);
          rawPos += byteWidth;
          pxPos += byteWidth;
        }
        return rawData;
      };
    }
  });

  // node_modules/pngjs/lib/packer.js
  var require_packer = __commonJS({
    "node_modules/pngjs/lib/packer.js"(exports, module) {
      "use strict";
      var constants = require_constants();
      var CrcStream = require_crc();
      var bitPacker = require_bitpacker();
      var filter = require_filter_pack();
      var zlib = __require("zlib");
      var Packer = module.exports = function(options) {
        this._options = options;
        options.deflateChunkSize = options.deflateChunkSize || 32 * 1024;
        options.deflateLevel = options.deflateLevel != null ? options.deflateLevel : 9;
        options.deflateStrategy = options.deflateStrategy != null ? options.deflateStrategy : 3;
        options.inputHasAlpha = options.inputHasAlpha != null ? options.inputHasAlpha : true;
        options.deflateFactory = options.deflateFactory || zlib.createDeflate;
        options.bitDepth = options.bitDepth || 8;
        options.colorType = typeof options.colorType === "number" ? options.colorType : constants.COLORTYPE_COLOR_ALPHA;
        options.inputColorType = typeof options.inputColorType === "number" ? options.inputColorType : constants.COLORTYPE_COLOR_ALPHA;
        if ([
          constants.COLORTYPE_GRAYSCALE,
          constants.COLORTYPE_COLOR,
          constants.COLORTYPE_COLOR_ALPHA,
          constants.COLORTYPE_ALPHA
        ].indexOf(options.colorType) === -1) {
          throw new Error("option color type:" + options.colorType + " is not supported at present");
        }
        if ([
          constants.COLORTYPE_GRAYSCALE,
          constants.COLORTYPE_COLOR,
          constants.COLORTYPE_COLOR_ALPHA,
          constants.COLORTYPE_ALPHA
        ].indexOf(options.inputColorType) === -1) {
          throw new Error("option input color type:" + options.inputColorType + " is not supported at present");
        }
        if (options.bitDepth !== 8 && options.bitDepth !== 16) {
          throw new Error("option bit depth:" + options.bitDepth + " is not supported at present");
        }
      };
      Packer.prototype.getDeflateOptions = function() {
        return {
          chunkSize: this._options.deflateChunkSize,
          level: this._options.deflateLevel,
          strategy: this._options.deflateStrategy
        };
      };
      Packer.prototype.createDeflate = function() {
        return this._options.deflateFactory(this.getDeflateOptions());
      };
      Packer.prototype.filterData = function(data, width, height) {
        var packedData = bitPacker(data, width, height, this._options);
        var bpp = constants.COLORTYPE_TO_BPP_MAP[this._options.colorType];
        var filteredData = filter(packedData, width, height, this._options, bpp);
        return filteredData;
      };
      Packer.prototype._packChunk = function(type, data) {
        var len = data ? data.length : 0;
        var buf = Buffer.alloc(len + 12);
        buf.writeUInt32BE(len, 0);
        buf.writeUInt32BE(type, 4);
        if (data) {
          data.copy(buf, 8);
        }
        buf.writeInt32BE(CrcStream.crc32(buf.slice(4, buf.length - 4)), buf.length - 4);
        return buf;
      };
      Packer.prototype.packGAMA = function(gamma) {
        var buf = Buffer.alloc(4);
        buf.writeUInt32BE(Math.floor(gamma * constants.GAMMA_DIVISION), 0);
        return this._packChunk(constants.TYPE_gAMA, buf);
      };
      Packer.prototype.packIHDR = function(width, height) {
        var buf = Buffer.alloc(13);
        buf.writeUInt32BE(width, 0);
        buf.writeUInt32BE(height, 4);
        buf[8] = this._options.bitDepth;
        buf[9] = this._options.colorType;
        buf[10] = 0;
        buf[11] = 0;
        buf[12] = 0;
        return this._packChunk(constants.TYPE_IHDR, buf);
      };
      Packer.prototype.packIDAT = function(data) {
        return this._packChunk(constants.TYPE_IDAT, data);
      };
      Packer.prototype.packIEND = function() {
        return this._packChunk(constants.TYPE_IEND, null);
      };
    }
  });

  // node_modules/pngjs/lib/packer-async.js
  var require_packer_async = __commonJS({
    "node_modules/pngjs/lib/packer-async.js"(exports, module) {
      "use strict";
      var util = __require("util");
      var Stream = __require("stream");
      var constants = require_constants();
      var Packer = require_packer();
      var PackerAsync = module.exports = function(opt) {
        Stream.call(this);
        var options = opt || {};
        this._packer = new Packer(options);
        this._deflate = this._packer.createDeflate();
        this.readable = true;
      };
      util.inherits(PackerAsync, Stream);
      PackerAsync.prototype.pack = function(data, width, height, gamma) {
        this.emit("data", Buffer.from(constants.PNG_SIGNATURE));
        this.emit("data", this._packer.packIHDR(width, height));
        if (gamma) {
          this.emit("data", this._packer.packGAMA(gamma));
        }
        var filteredData = this._packer.filterData(data, width, height);
        this._deflate.on("error", this.emit.bind(this, "error"));
        this._deflate.on("data", function(compressedData) {
          this.emit("data", this._packer.packIDAT(compressedData));
        }.bind(this));
        this._deflate.on("end", function() {
          this.emit("data", this._packer.packIEND());
          this.emit("end");
        }.bind(this));
        this._deflate.end(filteredData);
      };
    }
  });

  // node_modules/pngjs/lib/sync-inflate.js
  var require_sync_inflate = __commonJS({
    "node_modules/pngjs/lib/sync-inflate.js"(exports, module) {
      "use strict";
      var assert = __require("assert").ok;
      var zlib = __require("zlib");
      var util = __require("util");
      var kMaxLength = __require("buffer").kMaxLength;
      function Inflate(opts) {
        if (!(this instanceof Inflate)) {
          return new Inflate(opts);
        }
        if (opts && opts.chunkSize < zlib.Z_MIN_CHUNK) {
          opts.chunkSize = zlib.Z_MIN_CHUNK;
        }
        zlib.Inflate.call(this, opts);
        this._offset = this._offset === void 0 ? this._outOffset : this._offset;
        this._buffer = this._buffer || this._outBuffer;
        if (opts && opts.maxLength != null) {
          this._maxLength = opts.maxLength;
        }
      }
      function createInflate(opts) {
        return new Inflate(opts);
      }
      function _close(engine, callback) {
        if (callback) {
          process.nextTick(callback);
        }
        if (!engine._handle) {
          return;
        }
        engine._handle.close();
        engine._handle = null;
      }
      Inflate.prototype._processChunk = function(chunk, flushFlag, asyncCb) {
        if (typeof asyncCb === "function") {
          return zlib.Inflate._processChunk.call(this, chunk, flushFlag, asyncCb);
        }
        var self = this;
        var availInBefore = chunk && chunk.length;
        var availOutBefore = this._chunkSize - this._offset;
        var leftToInflate = this._maxLength;
        var inOff = 0;
        var buffers = [];
        var nread = 0;
        var error;
        this.on("error", function(err) {
          error = err;
        });
        function handleChunk(availInAfter, availOutAfter) {
          if (self._hadError) {
            return;
          }
          var have = availOutBefore - availOutAfter;
          assert(have >= 0, "have should not go down");
          if (have > 0) {
            var out = self._buffer.slice(self._offset, self._offset + have);
            self._offset += have;
            if (out.length > leftToInflate) {
              out = out.slice(0, leftToInflate);
            }
            buffers.push(out);
            nread += out.length;
            leftToInflate -= out.length;
            if (leftToInflate === 0) {
              return false;
            }
          }
          if (availOutAfter === 0 || self._offset >= self._chunkSize) {
            availOutBefore = self._chunkSize;
            self._offset = 0;
            self._buffer = Buffer.allocUnsafe(self._chunkSize);
          }
          if (availOutAfter === 0) {
            inOff += availInBefore - availInAfter;
            availInBefore = availInAfter;
            return true;
          }
          return false;
        }
        assert(this._handle, "zlib binding closed");
        do {
          var res = this._handle.writeSync(
            flushFlag,
            chunk,
            // in
            inOff,
            // in_off
            availInBefore,
            // in_len
            this._buffer,
            // out
            this._offset,
            //out_off
            availOutBefore
          );
          res = res || this._writeState;
        } while (!this._hadError && handleChunk(res[0], res[1]));
        if (this._hadError) {
          throw error;
        }
        if (nread >= kMaxLength) {
          _close(this);
          throw new RangeError("Cannot create final Buffer. It would be larger than 0x" + kMaxLength.toString(16) + " bytes");
        }
        var buf = Buffer.concat(buffers, nread);
        _close(this);
        return buf;
      };
      util.inherits(Inflate, zlib.Inflate);
      function zlibBufferSync(engine, buffer) {
        if (typeof buffer === "string") {
          buffer = Buffer.from(buffer);
        }
        if (!(buffer instanceof Buffer)) {
          throw new TypeError("Not a string or buffer");
        }
        var flushFlag = engine._finishFlushFlag;
        if (flushFlag == null) {
          flushFlag = zlib.Z_FINISH;
        }
        return engine._processChunk(buffer, flushFlag);
      }
      function inflateSync(buffer, opts) {
        return zlibBufferSync(new Inflate(opts), buffer);
      }
      module.exports = exports = inflateSync;
      exports.Inflate = Inflate;
      exports.createInflate = createInflate;
      exports.inflateSync = inflateSync;
    }
  });

  // node_modules/pngjs/lib/sync-reader.js
  var require_sync_reader = __commonJS({
    "node_modules/pngjs/lib/sync-reader.js"(exports, module) {
      "use strict";
      var SyncReader = module.exports = function(buffer) {
        this._buffer = buffer;
        this._reads = [];
      };
      SyncReader.prototype.read = function(length, callback) {
        this._reads.push({
          length: Math.abs(length),
          // if length < 0 then at most this length
          allowLess: length < 0,
          func: callback
        });
      };
      SyncReader.prototype.process = function() {
        while (this._reads.length > 0 && this._buffer.length) {
          var read = this._reads[0];
          if (this._buffer.length && (this._buffer.length >= read.length || read.allowLess)) {
            this._reads.shift();
            var buf = this._buffer;
            this._buffer = buf.slice(read.length);
            read.func.call(this, buf.slice(0, read.length));
          } else {
            break;
          }
        }
        if (this._reads.length > 0) {
          return new Error("There are some read requests waitng on finished stream");
        }
        if (this._buffer.length > 0) {
          return new Error("unrecognised content at end of stream");
        }
      };
    }
  });

  // node_modules/pngjs/lib/filter-parse-sync.js
  var require_filter_parse_sync = __commonJS({
    "node_modules/pngjs/lib/filter-parse-sync.js"(exports) {
      "use strict";
      var SyncReader = require_sync_reader();
      var Filter = require_filter_parse();
      exports.process = function(inBuffer, bitmapInfo) {
        var outBuffers = [];
        var reader = new SyncReader(inBuffer);
        var filter = new Filter(bitmapInfo, {
          read: reader.read.bind(reader),
          write: function(bufferPart) {
            outBuffers.push(bufferPart);
          },
          complete: function() {
          }
        });
        filter.start();
        reader.process();
        return Buffer.concat(outBuffers);
      };
    }
  });

  // node_modules/pngjs/lib/parser-sync.js
  var require_parser_sync = __commonJS({
    "node_modules/pngjs/lib/parser-sync.js"(exports, module) {
      "use strict";
      var hasSyncZlib = true;
      var zlib = __require("zlib");
      var inflateSync = require_sync_inflate();
      if (!zlib.deflateSync) {
        hasSyncZlib = false;
      }
      var SyncReader = require_sync_reader();
      var FilterSync = require_filter_parse_sync();
      var Parser = require_parser();
      var bitmapper = require_bitmapper();
      var formatNormaliser = require_format_normaliser();
      module.exports = function(buffer, options) {
        if (!hasSyncZlib) {
          throw new Error("To use the sync capability of this library in old node versions, please pin pngjs to v2.3.0");
        }
        var err;
        function handleError(_err_) {
          err = _err_;
        }
        var metaData;
        function handleMetaData(_metaData_) {
          metaData = _metaData_;
        }
        function handleTransColor(transColor) {
          metaData.transColor = transColor;
        }
        function handlePalette(palette) {
          metaData.palette = palette;
        }
        function handleSimpleTransparency() {
          metaData.alpha = true;
        }
        var gamma;
        function handleGamma(_gamma_) {
          gamma = _gamma_;
        }
        var inflateDataList = [];
        function handleInflateData(inflatedData2) {
          inflateDataList.push(inflatedData2);
        }
        var reader = new SyncReader(buffer);
        var parser = new Parser(options, {
          read: reader.read.bind(reader),
          error: handleError,
          metadata: handleMetaData,
          gamma: handleGamma,
          palette: handlePalette,
          transColor: handleTransColor,
          inflateData: handleInflateData,
          simpleTransparency: handleSimpleTransparency
        });
        parser.start();
        reader.process();
        if (err) {
          throw err;
        }
        var inflateData = Buffer.concat(inflateDataList);
        inflateDataList.length = 0;
        var inflatedData;
        if (metaData.interlace) {
          inflatedData = zlib.inflateSync(inflateData);
        } else {
          var rowSize = (metaData.width * metaData.bpp * metaData.depth + 7 >> 3) + 1;
          var imageSize = rowSize * metaData.height;
          inflatedData = inflateSync(inflateData, { chunkSize: imageSize, maxLength: imageSize });
        }
        inflateData = null;
        if (!inflatedData || !inflatedData.length) {
          throw new Error("bad png - invalid inflate data response");
        }
        var unfilteredData = FilterSync.process(inflatedData, metaData);
        inflateData = null;
        var bitmapData = bitmapper.dataToBitMap(unfilteredData, metaData);
        unfilteredData = null;
        var normalisedBitmapData = formatNormaliser(bitmapData, metaData);
        metaData.data = normalisedBitmapData;
        metaData.gamma = gamma || 0;
        return metaData;
      };
    }
  });

  // node_modules/pngjs/lib/packer-sync.js
  var require_packer_sync = __commonJS({
    "node_modules/pngjs/lib/packer-sync.js"(exports, module) {
      "use strict";
      var hasSyncZlib = true;
      var zlib = __require("zlib");
      if (!zlib.deflateSync) {
        hasSyncZlib = false;
      }
      var constants = require_constants();
      var Packer = require_packer();
      module.exports = function(metaData, opt) {
        if (!hasSyncZlib) {
          throw new Error("To use the sync capability of this library in old node versions, please pin pngjs to v2.3.0");
        }
        var options = opt || {};
        var packer = new Packer(options);
        var chunks = [];
        chunks.push(Buffer.from(constants.PNG_SIGNATURE));
        chunks.push(packer.packIHDR(metaData.width, metaData.height));
        if (metaData.gamma) {
          chunks.push(packer.packGAMA(metaData.gamma));
        }
        var filteredData = packer.filterData(metaData.data, metaData.width, metaData.height);
        var compressedData = zlib.deflateSync(filteredData, packer.getDeflateOptions());
        filteredData = null;
        if (!compressedData || !compressedData.length) {
          throw new Error("bad png - invalid compressed data response");
        }
        chunks.push(packer.packIDAT(compressedData));
        chunks.push(packer.packIEND());
        return Buffer.concat(chunks);
      };
    }
  });

  // node_modules/pngjs/lib/png-sync.js
  var require_png_sync = __commonJS({
    "node_modules/pngjs/lib/png-sync.js"(exports) {
      "use strict";
      var parse = require_parser_sync();
      var pack = require_packer_sync();
      exports.read = function(buffer, options) {
        return parse(buffer, options || {});
      };
      exports.write = function(png, options) {
        return pack(png, options);
      };
    }
  });

  // node_modules/pngjs/lib/png.js
  var require_png = __commonJS({
    "node_modules/pngjs/lib/png.js"(exports) {
      "use strict";
      var util = __require("util");
      var Stream = __require("stream");
      var Parser = require_parser_async();
      var Packer = require_packer_async();
      var PNGSync = require_png_sync();
      var PNG = exports.PNG = function(options) {
        Stream.call(this);
        options = options || {};
        this.width = options.width | 0;
        this.height = options.height | 0;
        this.data = this.width > 0 && this.height > 0 ? Buffer.alloc(4 * this.width * this.height) : null;
        if (options.fill && this.data) {
          this.data.fill(0);
        }
        this.gamma = 0;
        this.readable = this.writable = true;
        this._parser = new Parser(options);
        this._parser.on("error", this.emit.bind(this, "error"));
        this._parser.on("close", this._handleClose.bind(this));
        this._parser.on("metadata", this._metadata.bind(this));
        this._parser.on("gamma", this._gamma.bind(this));
        this._parser.on("parsed", function(data) {
          this.data = data;
          this.emit("parsed", data);
        }.bind(this));
        this._packer = new Packer(options);
        this._packer.on("data", this.emit.bind(this, "data"));
        this._packer.on("end", this.emit.bind(this, "end"));
        this._parser.on("close", this._handleClose.bind(this));
        this._packer.on("error", this.emit.bind(this, "error"));
      };
      util.inherits(PNG, Stream);
      PNG.sync = PNGSync;
      PNG.prototype.pack = function() {
        if (!this.data || !this.data.length) {
          this.emit("error", "No data provided");
          return this;
        }
        process.nextTick(function() {
          this._packer.pack(this.data, this.width, this.height, this.gamma);
        }.bind(this));
        return this;
      };
      PNG.prototype.parse = function(data, callback) {
        if (callback) {
          var onParsed, onError;
          onParsed = function(parsedData) {
            this.removeListener("error", onError);
            this.data = parsedData;
            callback(null, this);
          }.bind(this);
          onError = function(err) {
            this.removeListener("parsed", onParsed);
            callback(err, null);
          }.bind(this);
          this.once("parsed", onParsed);
          this.once("error", onError);
        }
        this.end(data);
        return this;
      };
      PNG.prototype.write = function(data) {
        this._parser.write(data);
        return true;
      };
      PNG.prototype.end = function(data) {
        this._parser.end(data);
      };
      PNG.prototype._metadata = function(metadata) {
        this.width = metadata.width;
        this.height = metadata.height;
        this.emit("metadata", metadata);
      };
      PNG.prototype._gamma = function(gamma) {
        this.gamma = gamma;
      };
      PNG.prototype._handleClose = function() {
        if (!this._parser.writable && !this._packer.readable) {
          this.emit("close");
        }
      };
      PNG.bitblt = function(src, dst, srcX, srcY, width, height, deltaX, deltaY) {
        srcX |= 0;
        srcY |= 0;
        width |= 0;
        height |= 0;
        deltaX |= 0;
        deltaY |= 0;
        if (srcX > src.width || srcY > src.height || srcX + width > src.width || srcY + height > src.height) {
          throw new Error("bitblt reading outside image");
        }
        if (deltaX > dst.width || deltaY > dst.height || deltaX + width > dst.width || deltaY + height > dst.height) {
          throw new Error("bitblt writing outside image");
        }
        for (var y = 0; y < height; y++) {
          src.data.copy(
            dst.data,
            (deltaY + y) * dst.width + deltaX << 2,
            (srcY + y) * src.width + srcX << 2,
            (srcY + y) * src.width + srcX + width << 2
          );
        }
      };
      PNG.prototype.bitblt = function(dst, srcX, srcY, width, height, deltaX, deltaY) {
        PNG.bitblt(this, dst, srcX, srcY, width, height, deltaX, deltaY);
        return this;
      };
      PNG.adjustGamma = function(src) {
        if (src.gamma) {
          for (var y = 0; y < src.height; y++) {
            for (var x = 0; x < src.width; x++) {
              var idx = src.width * y + x << 2;
              for (var i = 0; i < 3; i++) {
                var sample = src.data[idx + i] / 255;
                sample = Math.pow(sample, 1 / 2.2 / src.gamma);
                src.data[idx + i] = Math.round(sample * 255);
              }
            }
          }
          src.gamma = 0;
        }
      };
      PNG.prototype.adjustGamma = function() {
        PNG.adjustGamma(this);
      };
    }
  });

  // Plus-ins/PSD2UI-CEP/src/native.js
  var require_native = __commonJS({
    "Plus-ins/PSD2UI-CEP/src/native.js"(exports, module) {
      "use strict";
      function requireNative(name) {
        if (typeof cep_node !== "undefined" && cep_node && typeof cep_node.require === "function") {
          return cep_node.require(name);
        }
        if (typeof window !== "undefined" && window.cep_node && typeof window.cep_node.require === "function") {
          return window.cep_node.require(name);
        }
        if (typeof __require === "function") return __require(name);
        throw new Error("[PSD2UI_CEP_NODE_UNAVAILABLE] CEP 未启用内置 Node.js。");
      }
      module.exports = { requireNative };
    }
  });

  // Plus-ins/PSD2UI-CEP/src/storage.js
  var require_storage = __commonJS({
    "Plus-ins/PSD2UI-CEP/src/storage.js"(exports, module) {
      "use strict";
      var requireNative = require_native().requireNative;
      var fs = requireNative("fs");
      var path = requireNative("path");
      var os = requireNative("os");
      var formats = { utf8: "utf8", binary: "binary" };
      function callFs(method, args) {
        return new Promise(function(resolve, reject) {
          fs[method].apply(fs, args.concat(function(error, value) {
            if (error) reject(error);
            else resolve(value);
          }));
        });
      }
      function nativePathFromUrl(value) {
        let result = String(value || "");
        if (/^file:/i.test(result)) {
          result = result.slice(5);
          if (/^\/\/\//.test(result)) result = result.slice(2);
          if (/^\/[a-z]:[\\/]/i.test(result)) result = result.slice(1);
          try {
            result = decodeURI(result);
          } catch (_) {
          }
        } else if (/^[a-z][a-z0-9+.-]*:/i.test(result) && !/^[a-z]:[\\/]/i.test(result)) {
          throw new Error("[PSD2UI_FILE_URL_INVALID] 只支持本地文件路径。");
        }
        if (!result || result.indexOf("\0") !== -1 || !path.isAbsolute(result)) {
          throw new Error("[PSD2UI_FILE_PATH_INVALID] 文件路径必须是绝对路径。");
        }
        return path.resolve(result);
      }
      function assertChildName(name) {
        if (typeof name !== "string" || !name || name === "." || name === ".." || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
          throw new Error("[PSD2UI_ENTRY_NAME_INVALID] 文件或目录名不能包含路径、保留名或特殊字符。");
        }
        return name;
      }
      function isWithin(root, target) {
        const relative = path.relative(root, target);
        return relative === "" || !path.isAbsolute(relative) && relative !== ".." && relative.indexOf(".." + path.sep) !== 0;
      }
      async function statIfPresent(target) {
        try {
          return await callFs("lstat", [target]);
        } catch (error) {
          if (error.code === "ENOENT") return null;
          throw error;
        }
      }
      async function checkPath(target, root, mayBeMissing) {
        if (!isWithin(root, target)) throw new Error("[PSD2UI_PATH_ESCAPE] 文件路径超出已选择目录。");
        const stat = await statIfPresent(target);
        if (!stat && !mayBeMissing) {
          const missing = new Error("文件或目录不存在：" + target);
          missing.code = "ENOENT";
          throw missing;
        }
        if (stat && stat.isSymbolicLink()) throw new Error("[PSD2UI_PATH_LINK] 不允许通过符号链接读写资源。");
        const real = await callFs("realpath", [stat ? target : path.dirname(target)]);
        if (!isWithin(root, real)) throw new Error("[PSD2UI_PATH_ESCAPE] 文件实际路径超出已选择目录。");
        return stat;
      }
      var Entry = class _Entry {
        constructor(nativePath, root, isFolder, protectedRoot) {
          this.nativePath = nativePath;
          this.name = path.basename(nativePath);
          this.isFolder = Boolean(isFolder);
          this.isFile = !this.isFolder;
          this._root = root;
          this._protectedRoot = Boolean(protectedRoot);
        }
        async _check() {
          const stat = await checkPath(this.nativePath, this._root, false);
          if (this.isFolder !== stat.isDirectory() || this.isFile !== stat.isFile()) {
            throw new Error("[PSD2UI_ENTRY_CHANGED] 文件类型已改变：" + this.nativePath);
          }
        }
        async getEntries() {
          if (!this.isFolder) throw new Error("只有目录可以列出内容。");
          await this._check();
          const names = await callFs("readdir", [this.nativePath]);
          const result = [];
          for (const name of names) {
            const child = path.join(this.nativePath, name);
            const stat = await checkPath(child, this._root, false);
            if (stat.isDirectory() || stat.isFile()) result.push(new _Entry(child, this._root, stat.isDirectory(), false));
          }
          return result;
        }
        async createFolder(name) {
          if (!this.isFolder) throw new Error("只有目录可以创建子目录。");
          await this._check();
          const child = path.join(this.nativePath, assertChildName(name));
          await checkPath(child, this._root, true);
          await callFs("mkdir", [child]);
          return new _Entry(child, this._root, true, false);
        }
        async createFile(name, options) {
          if (!this.isFolder) throw new Error("只有目录可以创建文件。");
          await this._check();
          const child = path.join(this.nativePath, assertChildName(name));
          const stat = await checkPath(child, this._root, true);
          if (stat && !stat.isFile()) throw new Error("[PSD2UI_OUTPUT_PATH_CONFLICT] 目标不是文件：" + child);
          const descriptor = await callFs("open", [child, options && options.overwrite === true ? "w" : "wx"]);
          await callFs("close", [descriptor]);
          return new _Entry(child, this._root, false, false);
        }
        async read(options) {
          if (!this.isFile) throw new Error("只有文件可以读取。");
          await this._check();
          const binary = options && options.format === formats.binary;
          const data = await callFs("readFile", binary ? [this.nativePath] : [this.nativePath, "utf8"]);
          return binary ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data;
        }
        async write(value, options) {
          if (!this.isFile) throw new Error("只有文件可以写入。");
          await this._check();
          const binary = options && options.format === formats.binary;
          const BufferType = requireNative("buffer").Buffer;
          const data = binary ? BufferType.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value) : String(value);
          await callFs("writeFile", [this.nativePath, data, binary ? {} : { encoding: "utf8" }]);
        }
        async copyTo(destination, options) {
          if (!this.isFile || !destination || !destination.isFolder || typeof destination._check !== "function") {
            throw new Error("copyTo 要求源文件和目标目录。");
          }
          await this._check();
          await destination._check();
          const target = path.join(destination.nativePath, assertChildName(this.name));
          const stat = await checkPath(target, destination._root, true);
          if (stat && !stat.isFile()) throw new Error("[PSD2UI_OUTPUT_PATH_CONFLICT] 目标不是文件：" + target);
          if (path.resolve(target) === path.resolve(this.nativePath)) throw new Error("不能把文件复制到自身。");
          await callFs("copyFile", [
            this.nativePath,
            target,
            options && options.overwrite === true ? 0 : fs.constants.COPYFILE_EXCL
          ]);
          return new _Entry(target, destination._root, false, false);
        }
        async delete() {
          await this._check();
          if (this._protectedRoot) throw new Error("[PSD2UI_DELETE_ROOT] 不能删除已选择的输出根目录。");
          if (this.isFolder) {
            const children = await this.getEntries();
            for (const child of children) await child.delete();
            await this._check();
            await callFs("rmdir", [this.nativePath]);
          } else {
            await callFs("unlink", [this.nativePath]);
          }
        }
      };
      async function getEntryWithUrl(value) {
        const requested = nativePathFromUrl(value);
        const stat = await callFs("lstat", [requested]);
        if (stat.isSymbolicLink()) throw new Error("[PSD2UI_PATH_LINK] 不允许将符号链接作为资源入口。");
        if (!stat.isFile() && !stat.isDirectory()) throw new Error("资源入口必须是文件或目录。");
        const real = await callFs("realpath", [requested]);
        return new Entry(real, stat.isDirectory() ? real : path.dirname(real), stat.isDirectory(), stat.isDirectory());
      }
      function createStorage(options) {
        const config = options || {};
        let temporaryFolderPromise = null;
        const localFileSystem = {
          getEntryWithUrl,
          async getFolder() {
            const cepApi = typeof window !== "undefined" && window.cep || typeof cep !== "undefined" && cep;
            const picker = config.pickFolder || function() {
              if (!cepApi || !cepApi.fs) throw new Error("[PSD2UI_FOLDER_PICKER_UNAVAILABLE] CEP 未提供目录选择器。");
              const choose = cepApi.fs.showOpenDialogEx || cepApi.fs.showOpenDialog;
              if (typeof choose !== "function") throw new Error("CEP 未提供目录选择器。");
              const result = choose.call(cepApi.fs, false, true, "选择 PSD2UI 输出目录", "", "");
              if (result.err) throw new Error("选择输出目录失败，CEP 错误码：" + result.err);
              return result.data && result.data[0] || null;
            };
            const selected = await picker();
            if (!selected) return null;
            const entry = await getEntryWithUrl(selected);
            if (!entry.isFolder) throw new Error("请选择目录。");
            return entry;
          },
          async createPersistentToken(entry) {
            if (!entry || typeof entry._check !== "function") throw new Error("无法记住无效的资源入口。");
            await entry._check();
            return "psd2ui-cep-path-v1:" + encodeURIComponent(entry.nativePath);
          },
          async getEntryForPersistentToken(token) {
            const prefix = "psd2ui-cep-path-v1:";
            if (typeof token !== "string" || token.indexOf(prefix) !== 0) throw new Error("CEP 输出目录记录无效，请重新选择。");
            return getEntryWithUrl(decodeURIComponent(token.slice(prefix.length)));
          },
          getTemporaryFolder() {
            if (!temporaryFolderPromise) {
              temporaryFolderPromise = callFs("mkdtemp", [path.join(config.temporaryBase || os.tmpdir(), "psd2ui-cep-")]).then(getEntryWithUrl).catch(function(error) {
                temporaryFolderPromise = null;
                throw error;
              });
            }
            return temporaryFolderPromise;
          }
        };
        return { formats, localFileSystem };
      }
      module.exports = createStorage();
      module.exports.createStorage = createStorage;
      module.exports.nativePathFromUrl = nativePathFromUrl;
    }
  });

  // Plus-ins/PSD2UI-CEP/src/imaging.js
  var require_imaging = __commonJS({
    "Plus-ins/PSD2UI-CEP/src/imaging.js"(exports, module) {
      "use strict";
      var PNG = require_png().PNG;
      var BufferType = require_native().requireNative("buffer").Buffer;
      var defaultStorage = require_storage();
      var temporaryCounter = 0;
      var colorChunkTypes = ["iCCP", "sRGB", "gAMA", "cHRM"];
      function unsupported(message) {
        throw new Error("[PSD2UI_CEP_IMAGING_UNSUPPORTED] " + message);
      }
      function dimensions(width, height, allowEmpty) {
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < (allowEmpty ? 0 : 1) || height < (allowEmpty ? 0 : 1) || !Number.isSafeInteger(width * height * 4)) {
          throw new Error("[PSD2UI_CEP_PIXEL_SIZE_INVALID] 无效的像素尺寸。");
        }
      }
      function crc32(buffer) {
        let value = 4294967295;
        for (let index = 0; index < buffer.length; index += 1) {
          value ^= buffer[index];
          for (let bit = 0; bit < 8; bit += 1) value = value >>> 1 ^ (value & 1 ? 3988292384 : 0);
        }
        return (value ^ 4294967295) >>> 0;
      }
      function makeChunk(type, bytes) {
        const result = BufferType.alloc(bytes.length + 12);
        result.writeUInt32BE(bytes.length, 0);
        result.write(type, 4, 4, "ascii");
        bytes.copy(result, 8);
        result.writeUInt32BE(crc32(result.slice(4, bytes.length + 8)), bytes.length + 8);
        return result;
      }
      function colorChunks(buffer) {
        const result = [];
        for (let offset = 8; offset + 12 <= buffer.length; ) {
          const length = buffer.readUInt32BE(offset);
          if (length > buffer.length - offset - 12) throw new Error("PNG chunk 长度无效。");
          const type = buffer.toString("ascii", offset + 4, offset + 8);
          if (colorChunkTypes.indexOf(type) !== -1) result.push(BufferType.from(buffer.slice(offset, offset + length + 12)));
          offset += length + 12;
          if (type === "IEND") break;
        }
        return result;
      }
      function withColorChunks(encoded, chunks) {
        if (!chunks || !chunks.length) return encoded;
        const parts = [encoded.slice(0, 8)];
        for (let offset = 8; offset + 12 <= encoded.length; ) {
          const length = encoded.readUInt32BE(offset);
          const type = encoded.toString("ascii", offset + 4, offset + 8);
          if (colorChunkTypes.indexOf(type) === -1) parts.push(encoded.slice(offset, offset + length + 12));
          if (type === "IHDR") chunks.forEach(function(chunk) {
            parts.push(chunk);
          });
          offset += length + 12;
        }
        return BufferType.concat(parts);
      }
      function imageDataFromPixels(pixels, options, chunks) {
        const width = options.width, height = options.height, components = options.components;
        dimensions(width, height, true);
        if ([3, 4].indexOf(components) === -1) unsupported("仅支持 RGB 或 RGBA。");
        if (options.colorSpace && options.colorSpace !== "RGB") unsupported("仅支持 RGB 色彩空间。");
        if (options.chunky === false) unsupported("仅支持交错排列的 RGB(A) 像素。");
        if (!(pixels instanceof Uint8Array) && !(pixels instanceof Uint8ClampedArray)) unsupported("仅支持 8-bit 像素。");
        if (pixels.length !== width * height * components) throw new Error("像素缓冲区长度与图片尺寸不一致。");
        let data = new Uint8Array(pixels);
        const result = {
          width,
          height,
          components,
          componentSize: 8,
          colorSpace: "RGB",
          colorProfile: String(options.colorProfile || ""),
          hasAlpha: components === 4,
          pixelFormat: components === 4 ? "RGBA" : "RGB",
          isChunky: true,
          type: "image/uncompressed",
          _colorChunks: chunks || [],
          async getData(input) {
            if (!data) throw new Error("像素数据已释放。");
            if (input && input.chunky === false) unsupported("仅支持交错排列的 RGB(A) 像素。");
            return new Uint8Array(data);
          },
          dispose() {
            data = null;
            result._colorChunks = [];
          }
        };
        return result;
      }
      function requestedRectangle(bounds, width, height) {
        const source = bounds || {};
        const left = source.left == null ? 0 : Number(source.left);
        const top = source.top == null ? 0 : Number(source.top);
        const right = source.right != null ? Number(source.right) : source.width != null ? left + Number(source.width) : width;
        const bottom = source.bottom != null ? Number(source.bottom) : source.height != null ? top + Number(source.height) : height;
        if (![left, top, right, bottom].every(Number.isInteger) || right < left || bottom < top) {
          throw new Error("sourceBounds 必须是有效的整数像素范围。");
        }
        return {
          left: Math.max(0, Math.min(width, left)),
          top: Math.max(0, Math.min(height, top)),
          right: Math.max(0, Math.min(width, right)),
          bottom: Math.max(0, Math.min(height, bottom))
        };
      }
      function extractPixels(png, bounds, applyAlpha) {
        const requested = requestedRectangle(bounds, png.width, png.height);
        let left = requested.right, top = requested.bottom, right = requested.left, bottom = requested.top;
        for (let y = requested.top; y < requested.bottom; y += 1) {
          for (let x = requested.left; x < requested.right; x += 1) {
            if (!png.data[(y * png.width + x) * 4 + 3]) continue;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x + 1);
            bottom = Math.max(bottom, y + 1);
          }
        }
        if (right <= left || bottom <= top) {
          left = requested.left;
          top = requested.top;
          right = left;
          bottom = top;
        }
        const width = right - left, height = bottom - top;
        const components = applyAlpha === true || png.alpha === false ? 3 : 4;
        const pixels = new Uint8Array(width * height * components);
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const from = ((y + top) * png.width + x + left) * 4;
            const to = (y * width + x) * components;
            const alpha = png.data[from + 3];
            for (let channel = 0; channel < 3; channel += 1) {
              pixels[to + channel] = applyAlpha === true ? Math.round((png.data[from + channel] * alpha + 255 * (255 - alpha)) / 255) : png.data[from + channel];
            }
            if (components === 4) pixels[to + 3] = alpha;
          }
        }
        return { pixels, width, height, components, sourceBounds: { left, top, right, bottom } };
      }
      function createImaging(dependencies) {
        const config = dependencies || {};
        const storage = config.storage || defaultStorage;
        const invoke = config.invoke || function(method, params) {
          return require_photoshop().invoke(method, params);
        };
        const knownProfiles = /* @__PURE__ */ new Map();
        async function temporaryFile() {
          const folder = await storage.localFileSystem.getTemporaryFolder();
          temporaryCounter += 1;
          return folder.createFile("pixels-" + Date.now() + "-" + temporaryCounter + ".png", { overwrite: false });
        }
        async function getPixels(input) {
          const options = input || {};
          if (options.componentSize != null && options.componentSize !== 8) unsupported("当前图片导出只支持 8-bit 像素。");
          if (options.colorSpace && options.colorSpace !== "RGB") unsupported("当前图片导出只支持 RGB。");
          if (options.layerID != null || options.historyStateID != null) unsupported("当前图片导出只读取工作台文档合成图。");
          const file = await temporaryFile();
          try {
            const result = await invoke("exportPixels", {
              documentID: options.documentID,
              path: file.nativePath,
              colorProfile: options.colorProfile || void 0
            });
            if (!result || result.colorSpace !== "RGB") throw new Error("Photoshop 未返回有效 RGB 像素导出。");
            if (result.path && result.path !== file.nativePath) throw new Error("Photoshop 像素导出路径不符。");
            if (options.colorProfile && result.colorProfile !== options.colorProfile) {
              throw new Error("Photoshop 像素导出的色彩配置不符：" + (result.colorProfile || "<none>"));
            }
            const bytes = BufferType.from(await file.read({ format: storage.formats.binary }));
            const png = PNG.sync.read(bytes);
            if (png.depth !== 8) unsupported("Photoshop 导出的临时 PNG 不是 8-bit。");
            if (png.width !== result.width || png.height !== result.height) throw new Error("Photoshop 像素导出的画布尺寸不符。");
            const chunks = colorChunks(bytes);
            const profile = String(result.colorProfile || "");
            if (profile && chunks.length) knownProfiles.set(profile, chunks);
            const extracted = extractPixels(png, options.sourceBounds, options.applyAlpha);
            const imageData = imageDataFromPixels(extracted.pixels, {
              width: extracted.width,
              height: extracted.height,
              components: extracted.components,
              colorSpace: "RGB",
              colorProfile: profile
            }, chunks);
            return { imageData, sourceBounds: extracted.sourceBounds, level: 0 };
          } finally {
            await file.delete();
          }
        }
        async function createImageDataFromBuffer(buffer, options) {
          const input = options || {};
          if (input.componentSize != null && input.componentSize !== 8) unsupported("只支持 8-bit 像素。");
          let chunks = knownProfiles.get(String(input.colorProfile || "")) || [];
          if (!chunks.length && input.colorProfile === "sRGB IEC61966-2.1") chunks = [makeChunk("sRGB", BufferType.from([0]))];
          return imageDataFromPixels(buffer, input, chunks);
        }
        async function putPixels(input) {
          const options = input || {};
          const data = options.imageData;
          if (!data || typeof data.getData !== "function" || data.componentSize !== 8 || data.colorSpace !== "RGB") {
            unsupported("putPixels 要求 8-bit RGB(A) ImageData。");
          }
          dimensions(data.width, data.height, false);
          if (options.replace === false) unsupported("当前图片导出只支持替换临时图层的全部像素。");
          const target = options.targetBounds || {};
          if (Number(target.left || 0) !== 0 || Number(target.top || 0) !== 0 || target.width != null && target.width !== data.width || target.height != null && target.height !== data.height || target.right != null && target.right !== data.width || target.bottom != null && target.bottom !== data.height) {
            unsupported("当前图片导出只写入匹配临时画布的完整像素。");
          }
          const pixels = await data.getData({ chunky: true });
          if ([3, 4].indexOf(data.components) === -1 || pixels.length !== data.width * data.height * data.components) {
            throw new Error("ImageData 像素缓冲区无效。");
          }
          const rgba = BufferType.alloc(data.width * data.height * 4);
          for (let pixel = 0; pixel < data.width * data.height; pixel += 1) {
            for (let channel = 0; channel < 3; channel += 1) rgba[pixel * 4 + channel] = pixels[pixel * data.components + channel];
            rgba[pixel * 4 + 3] = data.components === 4 ? pixels[pixel * 4 + 3] : 255;
          }
          const encoded = withColorChunks(PNG.sync.write(
            { width: data.width, height: data.height, data: rgba },
            { bitDepth: 8, colorType: 6, inputColorType: 6, inputHasAlpha: true }
          ), data._colorChunks);
          const file = await temporaryFile();
          try {
            await file.write(encoded, { format: storage.formats.binary });
            return await invoke("importPixels", {
              documentID: options.documentID,
              layerID: options.layerID,
              path: file.nativePath,
              colorProfile: data.colorProfile,
              colorSpace: "RGB",
              replace: true,
              targetBounds: { left: 0, top: 0, width: data.width, height: data.height }
            });
          } finally {
            await file.delete();
          }
        }
        return { getPixels, createImageDataFromBuffer, putPixels };
      }
      module.exports = createImaging();
      module.exports.createImaging = createImaging;
    }
  });

  // Plus-ins/PSD2UI-CEP/src/photoshop.js
  var require_photoshop = __commonJS({
    "Plus-ins/PSD2UI-CEP/src/photoshop.js"(exports, module) {
      "use strict";
      var defaultTransport = require_hostRpc();
      var constants = Object.freeze({
        BlendMode: Object.freeze({ NORMAL: "normal", PASSTHROUGH: "passThrough" }),
        ElementPlacement: Object.freeze({ PLACEATBEGINNING: "placeAtBeginning" }),
        TrimType: Object.freeze({ TRANSPARENT: "transparent" }),
        SaveOptions: Object.freeze({ DONOTSAVECHANGES: "doNotSaveChanges" })
      });
      function nativePath(entry) {
        const value = typeof entry === "string" ? entry : entry && entry.nativePath;
        if (!value) throw new Error("Photoshop 文件操作需要本地文件 nativePath。");
        return String(value);
      }
      function createPhotoshopFacade(options) {
        const configuration = options || {};
        const transport = configuration.transport || defaultTransport;
        const documentCache = /* @__PURE__ */ new Map();
        const layerCache = /* @__PURE__ */ new Map();
        const documents = [];
        const listeners = [];
        let activeDocumentId = null;
        let pendingWrites = [];
        let operationTail = Promise.resolve();
        let modalTail = Promise.resolve();
        let operations = 0;
        let modalRunning = false;
        let stateSignature = "";
        let snapshotStamp = "";
        let snapshotProbe = null;
        let contentRevision = 0;
        const yieldHost = configuration.yieldHost || (() => new Promise((resolve) => setTimeout(resolve, 20)));
        function schedule(operation) {
          operations += 1;
          const result = operationTail.then(operation);
          operationTail = result.then(() => {
            operations -= 1;
          }, () => {
            operations -= 1;
          });
          return result;
        }
        function requireDocument(id) {
          const result = documentCache.get(String(id));
          if (!result || !result._present) throw new Error("Photoshop 文档已关闭或不存在：" + id);
          return result;
        }
        function requireLayer(documentId, layerId) {
          const result = layerCache.get(String(documentId) + ":" + String(layerId));
          if (!result || !result._present) throw new Error("Photoshop 图层已删除或不存在：" + layerId);
          return result;
        }
        function queueWrite(method, params, apply) {
          pendingWrites.push({ method, params, apply });
          apply();
        }
        function defineDataProperties(target, names) {
          names.forEach((name) => Object.defineProperty(target, name, {
            enumerable: true,
            get() {
              return target._data[name];
            }
          }));
        }
        function makeLayer(documentId, data) {
          const layer = {};
          Object.defineProperties(layer, {
            _data: { value: {}, writable: true },
            _present: { value: true, writable: true },
            _documentId: { value: documentId },
            parent: { value: null, writable: true, enumerable: true },
            layers: { value: [], enumerable: true }
          });
          defineDataProperties(layer, [
            "id",
            "kind",
            "bounds",
            "boundsNoEffects",
            "clipped",
            "hasLayerMask",
            "hasVectorMask",
            "textItem",
            "descriptor",
            "isBackgroundLayer"
          ]);
          ["name", "visible", "opacity", "blendMode"].forEach((property) => {
            Object.defineProperty(layer, property, {
              enumerable: true,
              get() {
                return layer._data[property];
              },
              set(value) {
                requireLayer(documentId, layer.id);
                const params = { documentId, layerId: layer.id };
                params[property] = value;
                queueWrite("setLayer", params, () => {
                  layer._data[property] = value;
                });
              }
            });
          });
          layer.duplicate = async (target, placement) => {
            requireLayer(documentId, layer.id);
            const targetDocumentId = target ? requireDocument(target.id).id : documentId;
            const value = await invoke("duplicate", {
              documentId,
              layerId: layer.id,
              targetDocumentId: target ? targetDocumentId : void 0,
              placement: placement || null
            });
            return requireLayer(targetDocumentId, value && (value.layerId != null ? value.layerId : value.id));
          };
          layer.translate = (offsetX, offsetY) => invoke("translate", {
            documentId,
            layerId: requireLayer(documentId, layer.id).id,
            offsetX: Number(offsetX),
            offsetY: Number(offsetY)
          });
          layer.moveTo = (parent, input) => {
            requireLayer(documentId, layer.id);
            const params = input || {};
            let parentId = "document-root";
            if (parent && parent !== requireDocument(documentId) && parent !== "document-root") {
              parentId = requireLayer(documentId, typeof parent === "object" ? parent.id : parent).id;
            }
            return invoke("move", {
              documentId,
              layerId: layer.id,
              parentId,
              beforeId: params.beforeId,
              afterId: params.afterId
            });
          };
          layer.ungroup = () => invoke("ungroup", { documentId, layerId: requireLayer(documentId, layer.id).id });
          layer.delete = () => invoke("delete", { documentId, layerId: requireLayer(documentId, layer.id).id });
          layer._data = data;
          return layer;
        }
        function makeDocument(data) {
          const document2 = {};
          Object.defineProperties(document2, {
            _data: { value: {}, writable: true },
            _present: { value: true, writable: true },
            _revision: { value: 0, writable: true },
            layers: { value: [], enumerable: true },
            activeLayers: { enumerable: true, get() {
              return (document2._data.activeLayerIds || []).map((id) => layerCache.get(String(document2.id) + ":" + String(id))).filter((layer) => layer && layer._present);
            } }
          });
          defineDataProperties(document2, ["id", "title", "name", "path", "width", "height", "resolution", "xmp"]);
          document2.createLayerGroup = async (input) => {
            const params = input || {};
            const value = await invoke("group", {
              documentId: requireDocument(document2.id).id,
              name: params.name,
              layerIds: (params.fromLayers || []).map((layer) => requireLayer(document2.id, layer.id).id)
            });
            return requireLayer(document2.id, value && (value.layerId != null ? value.layerId : value.id));
          };
          document2.save = () => invoke("save", { documentId: requireDocument(document2.id).id });
          document2.closeWithoutSaving = () => invoke("close", { documentId: requireDocument(document2.id).id });
          document2.close = (saveOption) => {
            if (saveOption !== constants.SaveOptions.DONOTSAVECHANGES) {
              return Promise.reject(new Error("CEP 兼容层只支持显式 closeWithoutSaving。"));
            }
            return document2.closeWithoutSaving();
          };
          document2.trim = (type) => invoke("trim", { documentId: requireDocument(document2.id).id, type });
          document2.saveAs = { png: (file, params, asCopy) => invoke("savePng", {
            documentId: requireDocument(document2.id).id,
            path: nativePath(file),
            options: params || {},
            asCopy: asCopy === true
          }) };
          document2._data = data;
          return document2;
        }
        function replaceArray(target, values) {
          target.length = 0;
          values.forEach((value) => target.push(value));
        }
        function applyState(state) {
          if (!state || !Array.isArray(state.documents)) throw new Error("Photoshop 宿主未返回完整文档状态。");
          app.version = String(state.version || "");
          contentRevision += 1;
          documentCache.forEach((document2) => {
            document2._present = false;
          });
          layerCache.forEach((layer) => {
            layer._present = false;
          });
          const next = state.documents.map((data) => {
            const key = String(data.id);
            let document2 = documentCache.get(key);
            const sameLayers = Boolean(document2 && document2._data.layers === data.layers);
            if (!document2) {
              document2 = makeDocument(data);
              documentCache.set(key, document2);
            }
            document2._data = data;
            document2._present = true;
            if (!sameLayers) document2._revision = contentRevision;
            function patchLayers(values, parent) {
              return (values || []).map((entry) => {
                const layerKey = key + ":" + String(entry.id);
                let layer = layerCache.get(layerKey);
                if (!layer) {
                  layer = makeLayer(data.id, entry);
                  layerCache.set(layerKey, layer);
                }
                layer._data = entry;
                layer._present = true;
                layer.parent = parent;
                replaceArray(layer.layers, patchLayers(entry.layers, layer));
                return layer;
              });
            }
            replaceArray(document2.layers, patchLayers(data.layers, document2));
            return document2;
          });
          replaceArray(documents, next);
          activeDocumentId = state.activeDocumentId;
          pendingWrites.forEach((write) => write.apply());
        }
        async function request(method, params) {
          const response = await (typeof transport === "function" ? transport(method, params) : transport.invoke(method, params));
          if (response && response.state) applyState(response.state);
          if (!response || response.ok !== true) {
            const details = response && response.error;
            const error = new Error(typeof details === "string" ? details : details && details.message || "Photoshop CEP 宿主操作失败：" + method);
            if (details && typeof details === "object") {
              if (details.code) error.code = details.code;
              if (details.issues) error.issues = details.issues;
            }
            throw error;
          }
          return response.value;
        }
        function signature(value) {
          return JSON.stringify(value);
        }
        function contentSignature(stamp) {
          return JSON.stringify(stamp, (key, value) => key === "activeDocumentId" || key === "activeLayerIds" ? void 0 : value);
        }
        async function synchronize(stamp) {
          if (!snapshotProbe || contentSignature(stamp) !== contentSignature(snapshotProbe)) return readState();
          stamp.documents.forEach((data) => {
            requireDocument(data.id)._data.activeLayerIds = data.activeLayerIds.slice();
          });
          activeDocumentId = stamp.activeDocumentId;
          snapshotProbe = stamp;
          snapshotStamp = signature(stamp);
          return { activeDocumentId, version: app.version, documents: documents.map((document2) => document2._data) };
        }
        async function readState(forceDocumentIds) {
          for (let attempt = 0; ; attempt++) {
            try {
              const forced = new Set((forceDocumentIds || []).map(String));
              const knownDocuments = snapshotProbe ? snapshotProbe.documents.filter((document2) => !forced.has(String(document2.id))) : [];
              const begin = await request("beginState", { knownDocuments });
              const reused = new Set((begin.reusedDocumentIds || []).map(String));
              const snapshot = Object.assign({}, begin.stamp, {
                documents: begin.stamp.documents.map((document2) => Object.assign({}, document2, {
                  layers: reused.has(String(document2.id)) ? requireDocument(document2.id)._data.layers : []
                }))
              });
              const owners = new Map(snapshot.documents.map((document2) => [String(document2.id), document2]));
              const layers = /* @__PURE__ */ new Map();
              let count = 0;
              for (; ; ) {
                await yieldHost();
                const page = await request("statePage", { token: begin.token });
                page.items.forEach((item) => {
                  const key = String(item.documentId) + ":";
                  const parent = item.parentId == null ? owners.get(String(item.documentId)) : layers.get(key + item.parentId);
                  if (!parent || !Array.isArray(item.layer.layers) || layers.has(key + item.layer.id)) {
                    throw new Error("Photoshop 分段状态的图层关系无效，请刷新。");
                  }
                  parent.layers.push(item.layer);
                  layers.set(key + item.layer.id, item.layer);
                });
                count += page.items.length;
                if (typeof globalThis.__PSD2UI_HOST_PROGRESS__ === "function") globalThis.__PSD2UI_HOST_PROGRESS__(count);
                if (page.done) break;
              }
              applyState(snapshot);
              snapshotProbe = begin.stamp;
              snapshotStamp = signature(begin.stamp);
              return snapshot;
            } catch (error) {
              if (error.code !== "PSD2UI_STATE_CHANGED" || attempt >= 1) throw error;
              await yieldHost();
            }
          }
        }
        async function send(method, params) {
          if (method === "state") return readState(documents.map((document2) => document2.id));
          const value = await request(method, params);
          if (["probe", "notificationEvents", "getXmp", "readManifest", "chooseFolder", "beginHistory"].indexOf(method) < 0) {
            await readState();
            if (["setXmp", "writeManifest"].indexOf(method) >= 0) {
              const document2 = requireDocument(params.documentId != null ? params.documentId : params.documentID);
              document2._revision = ++contentRevision;
            }
          }
          return value;
        }
        async function drainWrites() {
          let changed = false;
          while (pendingWrites.length) {
            const write = pendingWrites.shift();
            try {
              await request(write.method, write.params);
              changed = true;
            } catch (error) {
              pendingWrites = [];
              try {
                await send("state", {});
              } catch (refreshError) {
                error.refreshError = refreshError.message;
              }
              throw error;
            }
          }
          if (changed) await readState();
        }
        function invoke(method, params) {
          return schedule(async () => {
            await drainWrites();
            return send(method, params || {});
          });
        }
        function flush() {
          return schedule(drainWrites);
        }
        function refresh() {
          return schedule(async () => {
            await drainWrites();
            return synchronize(await request("probe", {}));
          });
        }
        const app = { documents };
        Object.defineProperty(documents, "add", { value: async (params) => {
          const value = await invoke("addDocument", params || {});
          return requireDocument(value && (value.documentId != null ? value.documentId : value.id));
        } });
        Object.defineProperty(app, "activeDocument", {
          enumerable: true,
          get() {
            return activeDocumentId == null ? null : documentCache.get(String(activeDocumentId)) || null;
          },
          set(document2) {
            const id = requireDocument(document2 && document2.id).id;
            if (String(activeDocumentId) === String(id)) return;
            queueWrite("activate", { documentId: id }, () => {
              activeDocumentId = id;
            });
          }
        });
        app.open = async (file) => {
          const value = await invoke("open", { path: nativePath(file) });
          return requireDocument(value && (value.documentId != null ? value.documentId : value.id));
        };
        function references(command) {
          const target = command._target;
          return Array.isArray(target) ? target : target && Array.isArray(target._ref) ? target._ref : target ? [target] : [];
        }
        function targetFor(command) {
          const refs = references(command);
          const documentRef = refs.find((ref) => ref._ref === "document");
          const layerRef = refs.find((ref) => ref._ref === "layer");
          const propertyRef = refs.find((ref) => ref._property);
          const document2 = requireDocument(documentRef && documentRef._id != null ? documentRef._id : activeDocumentId);
          return {
            document: document2,
            layer: layerRef ? requireLayer(document2.id, layerRef._id) : null,
            property: propertyRef && propertyRef._property
          };
        }
        function cachedGet(command) {
          const target = targetFor(command);
          if (target.property === "XMPMetadataAsUTF8") throw new Error("CEP 文档 XMP 按需读取，请使用异步 batchPlay。");
          if (!target.layer) throw new Error("CEP 同步 get 仅支持已缓存图层描述符和文档 XMP。");
          const descriptor = target.layer.descriptor || {};
          if (!target.property) return descriptor;
          const result = {};
          result[target.property] = descriptor[target.property];
          return result;
        }
        const action = {
          batchPlay(commands, params) {
            if (params && params.synchronousExecution) {
              return commands.map((command) => {
                if (command._obj !== "get") throw new Error("CEP 同步 batchPlay 不支持写操作：" + command._obj);
                return cachedGet(command);
              });
            }
            return schedule(async () => {
              await drainWrites();
              const results = [];
              for (const command of commands) {
                const target = targetFor(command);
                if (command._obj === "get") {
                  if (target.property === "XMPMetadataAsUTF8") {
                    results.push({ XMPMetadataAsUTF8: await send("getXmp", { documentId: target.document.id }) });
                  } else results.push(cachedGet(command));
                } else if (command._obj === "set" && target.property === "XMPMetadataAsUTF8") {
                  await send("setXmp", { documentId: target.document.id, xmp: command.to.XMPMetadataAsUTF8 });
                  results.push({});
                } else if (command._obj === "select" && target.layer) {
                  await send("select", {
                    documentId: target.document.id,
                    layerIds: [target.layer.id],
                    add: Boolean(command.selectionModifier && command.selectionModifier._value === "addToSelection"),
                    makeVisible: command.makeVisible === true
                  });
                  results.push({});
                } else throw new Error("CEP 兼容层尚未实现 batchPlay 命令：" + command._obj);
              }
              return results;
            });
          },
          addNotificationListener(events, listener) {
            listeners.push({ events: events.map(String), listener });
            return Promise.resolve();
          },
          removeNotificationListener(events, listener) {
            for (let i = listeners.length - 1; i >= 0; i -= 1) {
              if (listeners[i].listener === listener) listeners.splice(i, 1);
            }
            return Promise.resolve();
          }
        };
        const core = {
          // A selection change keeps the revision. Complete snapshots (including XMP
          // writes/undo) invalidate panel projections; optimistic writes are never cached.
          getDocumentRevision() {
            const document2 = app.activeDocument;
            return document2 && !operations && !pendingWrites.length && !modalRunning ? document2._revision : null;
          },
          isBusy() {
            return modalRunning || operations > 0 || pendingWrites.length > 0;
          },
          // Serializes this plugin's work only. CEP cannot acquire UXP's native modal
          // lock; host methods validate document/layer identity on every mutation.
          executeAsModal(callback) {
            const run = async () => {
              modalRunning = true;
              const histories = [];
              const hostControl = {
                async suspendHistory(params) {
                  const token = await invoke("beginHistory", {
                    documentId: params.documentID != null ? params.documentID : params.documentId,
                    name: params.name
                  });
                  histories.push(token);
                  return token;
                },
                async resumeHistory(token, commit) {
                  if (commit === false) pendingWrites = [];
                  const result2 = await invoke("endHistory", { token, commit: commit !== false });
                  const index = histories.indexOf(token);
                  if (index >= 0) histories.splice(index, 1);
                  return result2;
                }
              };
              try {
                await refresh();
                const value = await callback({ hostControl, isCancelled: false });
                await flush();
                if (histories.length) throw new Error("Photoshop 历史事务未结束，已请求恢复。");
                return value;
              } catch (error) {
                pendingWrites = [];
                const rollbackErrors = [];
                for (let i = histories.length - 1; i >= 0; i -= 1) {
                  try {
                    await invoke("endHistory", { token: histories[i], commit: false });
                  } catch (rollbackError) {
                    rollbackErrors.push(rollbackError.message);
                  }
                }
                try {
                  await refresh();
                } catch (refreshError) {
                  rollbackErrors.push(refreshError.message);
                }
                if (rollbackErrors.length) error.message += "\nCEP 宿主恢复或状态检查失败：" + rollbackErrors.join("；");
                throw error;
              } finally {
                modalRunning = false;
              }
            };
            const result = modalTail.then(run);
            modalTail = result.catch(() => {
            });
            return result;
          }
        };
        async function poll() {
          if (modalRunning || operations || pendingWrites.length) return { skipped: true };
          await refresh();
          const next = snapshotStamp;
          if (next !== stateSignature) {
            stateSignature = next;
            listeners.slice().forEach((entry) => {
              if (entry.events.indexOf("select") >= 0) {
                try {
                  entry.listener("select", { documentID: activeDocumentId });
                } catch (error) {
                  if (typeof console !== "undefined") console.error(error);
                }
              }
            });
          }
          return { skipped: false };
        }
        const facade2 = {
          app,
          action,
          core,
          constants,
          invoke,
          refresh,
          flush,
          poll,
          async initialize() {
            const value = await refresh();
            stateSignature = snapshotStamp;
            return value;
          },
          isBusy() {
            return modalRunning || operations > 0 || pendingWrites.length > 0;
          }
        };
        Object.defineProperty(facade2, "imaging", { enumerable: true, get() {
          return configuration.imaging || require_imaging();
        } });
        facade2._facade = facade2;
        return facade2;
      }
      var facade = createPhotoshopFacade();
      facade.createPhotoshopFacade = createPhotoshopFacade;
      module.exports = facade;
    }
  });

  // Plus-ins/PSD2UI-CEP/src/commandServer.js
  var require_commandServer = __commonJS({
    "Plus-ins/PSD2UI-CEP/src/commandServer.js"(exports, module) {
      "use strict";
      var http = __require("http");
      var fs = __require("fs");
      var path = __require("path");
      var os = __require("os");
      var crypto = __require("crypto");
      var Protocol = 1;
      var PluginId = "com.yoyoengine.psd2ui.cep";
      var AllowedMethods = [
        "openDocument",
        "inspect",
        "snapshot",
        "initialize",
        "wrapDocumentRoot",
        "execute",
        "applyConfirmedStructurePlan",
        "applyConfirmedPreinitializeRenames",
        "applyConfirmedSubmoduleMigration",
        "preflight",
        "exportBundle"
      ];
      function mkdir(directory) {
        if (fs.existsSync(directory)) return;
        const parent = path.dirname(directory);
        if (parent !== directory) mkdir(parent);
        try {
          fs.mkdirSync(directory, 448);
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
      }
      function sessionsDirectory() {
        return path.join(os.homedir(), ".psd2ui", "cep", "sessions");
      }
      function json(response, status, value) {
        response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        response.end(JSON.stringify(value));
      }
      function readBody(request) {
        return new Promise((resolve, reject) => {
          let content = "", size = 0;
          request.setEncoding("utf8");
          request.on("data", (chunk) => {
            size += Buffer.byteLength(chunk);
            if (size > 8 * 1024 * 1024) {
              reject(new Error("结构计划超过 8 MiB。"));
              request.destroy();
            } else content += chunk;
          });
          request.on("end", () => {
            try {
              resolve(JSON.parse(content));
            } catch (error) {
              reject(error);
            }
          });
          request.on("error", reject);
        });
      }
      async function startCommandServer(options) {
        const input = options || {};
        const directory = input.directory || sessionsDirectory();
        mkdir(directory);
        const instanceId = crypto.randomBytes(16).toString("hex");
        const token = crypto.randomBytes(32).toString("hex");
        const operations = /* @__PURE__ */ new Map();
        const journal = path.join(directory, instanceId + ".operations");
        mkdir(journal);
        const sessionPath = path.join(directory, instanceId + ".json");
        let queue = Promise.resolve();
        let closed = false;
        function persist(job) {
          const target = path.join(journal, job.id + ".json");
          const staging = target + ".tmp";
          fs.writeFileSync(staging, JSON.stringify(job), { encoding: "utf8", mode: 384 });
          fs.renameSync(staging, target);
        }
        function publicJob(job) {
          return { id: job.id, instanceId, state: job.state, result: job.result, error: job.error };
        }
        const server = http.createServer(async (request, response) => {
          try {
            if (request.headers.origin || request.headers.authorization !== "Bearer " + token) {
              json(response, 403, { error: "本地插件连接凭据无效。" });
              return;
            }
            if (request.method === "GET" && request.url === "/status") {
              json(response, 200, __spreadValues({
                protocol: Protocol,
                pluginId: PluginId,
                pluginVersion: "0.3.8",
                transport: "cep",
                instanceId,
                methods: AllowedMethods
              }, input.status && input.status()));
              return;
            }
            const match = /^\/operations\/([a-zA-Z0-9_-]{8,100})$/.exec(request.url || "");
            if (request.method === "GET" && match) {
              const job2 = operations.get(match[1]);
              json(response, job2 ? 200 : 404, job2 ? publicJob(job2) : { state: "unknown", id: match[1], instanceId });
              return;
            }
            if (request.method !== "POST" || request.url !== "/invoke") {
              json(response, 404, { error: "未知命令接口。" });
              return;
            }
            const body = await readBody(request);
            if (!body || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.id || "") || AllowedMethods.indexOf(body.method) < 0 || !body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
              json(response, 400, { error: "无效命令、请求 ID 或参数。" });
              return;
            }
            const fingerprint = crypto.createHash("sha256").update(JSON.stringify([body.method, body.payload])).digest("hex");
            const existing = operations.get(body.id);
            if (existing) {
              json(
                response,
                existing.fingerprint === fingerprint ? 200 : 409,
                existing.fingerprint === fingerprint ? publicJob(existing) : { error: "同一请求 ID 对应了不同操作。" }
              );
              return;
            }
            if (operations.size >= 2048) {
              json(response, 503, { error: "本次插件会话操作记录已满，请完成当前工作后重开面板。" });
              return;
            }
            const job = { id: body.id, fingerprint, method: body.method, state: "queued", createdAt: Date.now() };
            persist(job);
            operations.set(body.id, job);
            queue = queue.then(async () => {
              if (closed) {
                job.state = "failed";
                job.error = { message: "插件已关闭，计划未执行。" };
                persist(job);
                return;
              }
              job.state = "running";
              persist(job);
              try {
                const action = async () => {
                  if (input.beforeInvoke) await input.beforeInvoke();
                  if (typeof input.automation[body.method] !== "function") throw new Error("此版本插件不支持命令 " + body.method);
                  return input.automation[body.method](body.payload);
                };
                job.result = await (input.run ? input.run(body.method, action) : action());
                if (input.isUncertain && input.isUncertain()) {
                  const unknown = new Error("Photoshop 宿主结果未知，请检查操作回执和文档，不能重发修改。");
                  unknown.code = "CEP_HOST_RESULT_UNKNOWN";
                  throw unknown;
                }
                job.state = "succeeded";
              } catch (error) {
                job.state = input.isUncertain && input.isUncertain() || ["PSD2UI_RESULT_UNKNOWN", "CEP_HOST_RESULT_UNKNOWN", "CEP_HOST_RESPONSE_INVALID"].indexOf(error.code) >= 0 ? "unknown" : "failed";
                job.error = { message: error.message || String(error), code: error.code || "PSD2UI_COMMAND_FAILED" };
                if (Array.isArray(error.issues)) job.error.issues = error.issues;
              }
              persist(job);
            }).catch((error) => {
              console.error("PSD2UI 操作记录保存失败：", error);
            });
            json(response, 202, publicJob(job));
          } catch (error) {
            if (!response.headersSent) json(response, 500, { error: error.message || String(error) });
          }
        });
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
        const session = { protocol: Protocol, pluginId: PluginId, instanceId, port: server.address().port, token, pid: process.pid };
        fs.writeFileSync(sessionPath, JSON.stringify(session), { encoding: "utf8", mode: 384 });
        return { session, journal, close() {
          closed = true;
          server.close();
          try {
            fs.unlinkSync(sessionPath);
          } catch (error) {
            if (error.code !== "ENOENT") console.error(error);
          }
        } };
      }
      module.exports = { startCommandServer, sessionsDirectory, PluginId, Protocol, AllowedMethods };
    }
  });

  // Plus-ins/PSD2UI-CEP/src/notifications.js
  var require_notifications = __commonJS({
    "Plus-ins/PSD2UI-CEP/src/notifications.js"(exports, module) {
      "use strict";
      async function startNotifications(options) {
        const { bridge, photoshop, document: document2, window: window2 } = options;
        const later = options.setTimeout || setTimeout;
        const cancel = options.clearTimeout || clearTimeout;
        const report = options.onError || ((error) => console.error("PSD2UI 刷新失败：", error.message));
        let closed = false, running = false, dirty = false, timer = null, watchdog = null;
        let eventType, extensionId, eventIds, appId;
        function blocked() {
          return document2.hidden === true || photoshop.isBusy() || options.isBusy() || options.isUncertain();
        }
        function schedule(delay) {
          if (closed) return;
          dirty = true;
          if (timer != null) cancel(timer);
          timer = later(refresh, delay);
        }
        async function refresh() {
          timer = null;
          if (closed || options.isUncertain()) return;
          if (document2.hidden === true) return;
          if (running || blocked()) {
            schedule(200);
            return;
          }
          dirty = false;
          running = true;
          try {
            const result = await photoshop.poll();
            if (result && result.skipped) dirty = true;
          } catch (error) {
            report(error);
          } finally {
            running = false;
            if (dirty && !closed) schedule(120);
          }
        }
        function changed() {
          schedule(120);
        }
        function visible() {
          if (document2.hidden !== true) changed();
        }
        function register(type) {
          bridge.dispatchEvent({ type, scope: "APPLICATION", appId, extensionId, data: eventIds.join(",") });
        }
        let subscribed = false;
        try {
          if (bridge && bridge.addEventListener && bridge.removeEventListener && bridge.dispatchEvent && bridge.getExtensionId && bridge.getHostEnvironment) {
            eventIds = await photoshop.invoke("notificationEvents", {});
            if (!Array.isArray(eventIds) || !eventIds.length) throw new Error("Photoshop 未返回事件 ID。");
            extensionId = bridge.getExtensionId();
            appId = JSON.parse(bridge.getHostEnvironment()).appId;
            if (!appId) throw new Error("Photoshop 未返回事件目标应用 ID。");
            eventType = "com.adobe.PhotoshopJSONCallback" + extensionId;
            bridge.addEventListener(eventType, changed);
            register("com.adobe.PhotoshopRegisterEvent");
            subscribed = true;
          }
        } catch (error) {
          if (eventType) bridge.removeEventListener(eventType, changed);
          report(error);
        }
        if (document2.addEventListener) document2.addEventListener("visibilitychange", visible);
        window2.addEventListener("focus", visible);
        function check() {
          if (closed || options.isUncertain()) return;
          if (!running && !blocked() && timer == null) schedule(0);
          watchdog = later(check, subscribed ? 15e3 : 1500);
        }
        watchdog = later(check, subscribed ? 15e3 : 1500);
        return {
          close() {
            closed = true;
            cancel(timer);
            cancel(watchdog);
            if (document2.removeEventListener) document2.removeEventListener("visibilitychange", visible);
            if (window2.removeEventListener) window2.removeEventListener("focus", visible);
            if (subscribed) {
              try {
                register("com.adobe.PhotoshopUnRegisterEvent");
              } catch (error) {
                report(error);
              }
              bridge.removeEventListener(eventType, changed);
            }
          }
        };
      }
      module.exports = { startNotifications };
    }
  });

  // Plus-ins/PSD2UI/uiShell.js
  var require_uiShell = __commonJS({
    "Plus-ins/PSD2UI/uiShell.js"() {
      "use strict";
      (function createPanelShell(global) {
        const PanelEntries = Object.freeze([
          Object.freeze({ name: "prepare", tabId: "tab-prepare", panelId: "panel-prepare" }),
          Object.freeze({ name: "layer", tabId: "tab-layer", panelId: "panel-layer" }),
          Object.freeze({ name: "export", tabId: "tab-export", panelId: "panel-export" }),
          Object.freeze({ name: "settings", tabId: "tab-settings", panelId: "panel-settings" })
        ]);
        const NoParametersPanel = "options-no-parameters";
        const SemanticEntries = Object.freeze([
          Object.freeze({
            name: "image",
            optionId: "options-image",
            title: "图片 / Image",
            commit: "图片语义 + imageType/九宫",
            description: "图片的尺寸、颜色与透明度由 Photoshop 自动解析。"
          }),
          Object.freeze({
            name: "raw-image",
            optionId: NoParametersPanel,
            title: "独立贴图 / Raw Image",
            commit: "独立贴图类型（无参数）",
            description: "使用独立纹理；未配置图片面积达到 512 × 512 px 或任一边超过 2040 px 时默认使用。"
          }),
          Object.freeze({
            name: "text",
            optionId: "options-text",
            title: "文本 / Text",
            commit: "文本语义 + fontKey",
            description: "文字内容、排版、渐变、描边和阴影从 Photoshop 读取。"
          }),
          Object.freeze({
            name: "button",
            optionId: NoParametersPanel,
            title: "按钮 / Button",
            commit: "按钮语义（可结构化）",
            description: "指定按钮背景与可选文字；装饰和普通子组可以保留。"
          }),
          Object.freeze({
            name: "input-field",
            optionId: NoParametersPanel,
            title: "输入框 / Input Field",
            commit: "输入框语义（可结构化）",
            description: "指定背景、输入文字及可选占位文字。"
          }),
          Object.freeze({
            name: "toggle",
            optionId: NoParametersPanel,
            title: "开关 / Toggle",
            commit: "开关语义（可结构化）",
            description: "明确选择背景与开启图案，可加文字标签。"
          }),
          Object.freeze({
            name: "list",
            optionId: NoParametersPanel,
            title: "列表 / List",
            commit: "列表语义（可结构化）",
            description: "指定条目模板、仅供预览的样例，以及方向、尺寸和间距。"
          }),
          Object.freeze({
            name: "grid",
            optionId: NoParametersPanel,
            title: "网格 / Grid",
            commit: "网格语义（可结构化）",
            description: "指定单元格模板、预览样例和行列布局。"
          }),
          Object.freeze({
            name: "red-point",
            optionId: NoParametersPanel,
            title: "红点 / Red Point",
            commit: "红点语义（无参数）",
            description: "标记红点图片；显示条件由项目程序配置。"
          }),
          Object.freeze({
            name: "toggle-page-group",
            optionId: NoParametersPanel,
            title: "页签页面组 / Toggle Page Group",
            commit: "页签页面组语义（可结构化）",
            description: "组件组内至少有 1 个已经结构化的直属开关组；页面数据由项目代码提供。"
          }),
          Object.freeze({
            name: "list-page-group",
            optionId: NoParametersPanel,
            title: "列表页面组 / List Page Group",
            commit: "列表页面组语义（可结构化）",
            description: "组件组内有 1 个已经结构化的直属列表组；业务页面数据由项目代码提供。"
          }),
          Object.freeze({
            name: "ignore",
            optionId: "options-ignore",
            title: "忽略子树 / Ignore",
            commit: "忽略子树",
            description: "选中图层及其全部子层不会进入导出的 UI Bundle。"
          })
        ]);
        const StructuredSemanticNames = Object.freeze([
          "button",
          "input-field",
          "toggle",
          "list",
          "grid",
          "toggle-page-group",
          "list-page-group"
        ]);
        const OptionPanelIds = Object.freeze([
          "options-group",
          "options-image",
          "options-raw-image",
          "options-text",
          "options-button",
          "options-ignore",
          NoParametersPanel
        ]);
        let panelChangeHandler = null;
        let semanticAvailability = null;
        let semanticBlockedReason = "";
        const Guides = {
          button: {
            tree: "购买按钮  ← 选这个组\n├─ 按钮底图  → 背景\n├─ 购买文字  → 文字\n└─ 图标 / 光效  → 保留装饰",
            steps: ["选完整的「购买按钮」组，类型选「按钮」。", "把底图指定为背景，文字指定为标签，点击「保存组件配置」。", "切换到别的图层，再回来：当前类型应显示「按钮」。"],
            note: "只有一张按钮图片时，直接选图层、选按钮、保存当前图层即可。装饰不需要逐一分配角色。"
          },
          "input-field": {
            tree: "输入框  ← 选这个组\n├─ 底框  → 背景\n├─ 输入文字  → 输入文本\n└─ 请输入昵称  → 占位文本",
            steps: ["把底框和文字放在同一个输入框组内。", "选外组，类型选「输入框」，分别指定背景、输入文本和可选占位文本。", "保存组件配置；输入文字与占位文字使用两个不同文字层。"],
            note: "图片角色选图片，文本角色选 Photoshop 文字层。"
          },
          toggle: {
            tree: "声音开关  ← 选这个组\n├─ 底图  → 背景\n├─ 勾选图案  → 开启图案\n└─ 声音  → 文字",
            steps: ["先把开关的两种视觉元素拆成独立图层。", "选开关组，指定背景和开启图案，按需要指定文字。", "保存组件配置。一个可点击的列表条目不必都标成开关。"],
            note: "列表的单选、多选和点击行为由程序接入。"
          },
          list: {
            tree: "商品列表  ← 最后配置这个组\n├─ 商品条目  → 条目模板\n│  ├─ 图标 / 名称 / 价格\n│  └─ 购买按钮  → 先配内部按钮\n├─ 商品样例二  → 仅预览\n└─ 商品样例三  → 仅预览",
            steps: ["先选模板里的购买按钮，完成按钮配置。条目组可保留为普通组。", "回到「商品列表」外组，类型选「列表」，条目模板选「商品条目」。", "勾选其余重复条目为「仅预览样例」，填写方向、条目尺寸和间距，然后保存。"],
            note: "模板是重复内容的一整项，不是一张背景图。仅预览样例留在 PSD；列表的数据、点击和选中状态由程序接入。"
          },
          grid: {
            tree: "背包网格  ← 选这个组\n├─ 物品格  → 单元格模板\n│  ├─ 底框 / 物品图标\n│  └─ 数量文字\n├─ 格子样例二  → 仅预览\n└─ 格子样例三  → 仅预览",
            steps: ["把一整格的底框、图标和数量放进同一个模板组。", "选背包网格外组，类型选「网格」，指定单元格模板与预览样例。", "填写格子宽高、列数与间距，保存组件配置。"],
            note: "每个格子内部需要的按钮、红点先单独配置；模板内部不限制装饰数量。"
          },
          "toggle-page-group": {
            tree: "分类页签  ← 最后配置这个组\n├─ 装备页签  → 已配置的开关组\n└─ 材料页签  → 已配置的开关组",
            steps: ["先分别选每个页签，按「开关」指定背景与选中图案并保存。", "这些开关组应直接放在「分类页签」下面。", "选分类页签外组，类型选「页签页面组」，指定页签角色并保存。"],
            note: "页面内容、页签对应哪个页面和点击切换，由程序接入。"
          },
          "list-page-group": {
            tree: "动态分类  ← 最后配置这个组\n└─ 分类列表  → 已配置的列表组\n   ├─ 页签条目  → 条目模板\n   └─ 页签样例  → 仅预览",
            steps: ["先按「列表」完成分类列表的模板和布局配置。", "把该列表组直接放在动态分类组下。", "选动态分类外组，类型选「列表页面组」，指定内部列表并保存。"],
            note: "外层引用完整列表组件，内部的条目角色仍归列表管理。"
          },
          states: {
            tree: "奖励条目  ← 选这个组\n├─ 可领取  → normal\n├─ 未解锁  → locked\n└─ 已领取  → claimed",
            steps: ["每种完整外观单独建一个组，放在同一个条目组内。", "选择条目组，在「视觉状态」添加状态名称和对应组，并指定默认状态。", "保存状态配置，再选择状态预览；预览结束点击「恢复原可见性」。"],
            note: "状态名可自定义。预览是临时显示；运行时何时切换由程序接入。"
          }
        };
        function renderGuide() {
          const choice = element("component-guide-kind");
          const guide = Guides[choice && choice.value] || Guides.button;
          element("component-guide-tree").textContent = guide.tree;
          element("component-guide-note").textContent = guide.note;
          const steps = element("component-guide-steps");
          while (steps.firstChild) steps.removeChild(steps.firstChild);
          guide.steps.forEach((text, index) => {
            const paragraph = document.createElement("p");
            paragraph.className = "guide-step";
            paragraph.textContent = "".concat(index + 1, ". ").concat(text);
            steps.appendChild(paragraph);
          });
        }
        function element(id) {
          return document.getElementById(id);
        }
        function requireEntry(entries, name, label) {
          const entry = entries.find((candidate) => candidate.name === name);
          if (!entry) throw new Error("".concat(label, " '").concat(name, "' 未注册。"));
          return entry;
        }
        function setClassState(target, className, enabled) {
          if (!target) return;
          if (enabled) target.classList.add(className);
          else target.classList.remove(className);
        }
        function activatePanel(panelName) {
          requireEntry(PanelEntries, panelName, "功能区");
          PanelEntries.forEach((entry) => {
            const active = entry.name === panelName;
            const tab = element(entry.tabId);
            const panel = element(entry.panelId);
            setClassState(tab, "is-active", active);
            tab.setAttribute("aria-pressed", active ? "true" : "false");
            tab.setAttribute("aria-selected", active ? "true" : "false");
            setClassState(panel, "is-active", active);
          });
          element("app-shell").scrollTop = 0;
        }
        function setPanelChangeHandler(handler) {
          panelChangeHandler = typeof handler === "function" ? handler : null;
        }
        function setStatusExpanded(expanded) {
          setClassState(element("status-content"), "is-hidden", !expanded);
          element("status-toggle").setAttribute("aria-expanded", expanded ? "true" : "false");
          element("status-chevron").textContent = expanded ? "−" : "+";
          const shell = element("app-shell");
          if (shell.style) shell.style.bottom = expanded ? "220px" : "49px";
        }
        function setAdvancedResourceVisible(visible) {
          setClassState(element("advanced-resource-panel"), "is-hidden", !visible);
        }
        function setInternalSettingsVisible(visible) {
          setClassState(element("internal-settings-panel"), "is-hidden", !visible);
          const toggle = element("internal-settings-toggle");
          if (toggle) toggle.setAttribute("aria-expanded", visible ? "true" : "false");
        }
        function updateSemanticOptions() {
          if (!element("semantic").value) {
            OptionPanelIds.forEach((id) => setClassState(element(id), "is-hidden", true));
            element("semantic-summary-title").textContent = "未设置组件";
            element("semantic-summary-text").textContent = "普通组保留层级；未配置的空组自动跳过导出。需要组件时选择类型后再配置。";
            element("commit-semantic").textContent = "选择组件类型后配置";
            updateSemanticActionState();
            return;
          }
          const selectedEntry = requireEntry(SemanticEntries, element("semantic").value, "组件语义");
          OptionPanelIds.forEach((id) => setClassState(element(id), "is-hidden", id !== selectedEntry.optionId));
          element("semantic-summary-title").textContent = selectedEntry.title;
          element("semantic-summary-text").textContent = selectedEntry.description;
          element("commit-semantic").textContent = "保存".concat(selectedEntry.title.split("/")[0].trim(), "配置");
          updateSemanticActionState();
        }
        function updateSemanticActionState() {
          if (!semanticAvailability) return;
          const semantic = element("semantic").value;
          const state = semanticAvailability.find((entry) => entry.semantic === semantic);
          const hasExecutableAction = semanticAvailability.some((entry) => entry.canApply || entry.canStructure || entry.canConfigure);
          element("apply-preset").disabled = Boolean(semanticBlockedReason) || !state || !state.canApply;
          const configurable = state && (state.canConfigure || state.canStructure);
          element("structure-component").disabled = Boolean(semanticBlockedReason) || !configurable || Boolean(state.requiresGroup);
          const combine = element("combine-component");
          if (combine) combine.disabled = Boolean(semanticBlockedReason) || !configurable || !state.requiresGroup;
          setClassState(element("apply-preset"), "is-hidden", !state || !state.canApply || Boolean(configurable));
          setClassState(element("structure-component"), "is-hidden", !configurable || Boolean(state.requiresGroup));
          setClassState(combine, "is-hidden", !configurable || !state.requiresGroup);
          let message = semanticBlockedReason;
          if (!message && !semantic) message = "尚未设置组件；选择类型后可查看配置要求。";
          if (!message && !hasExecutableAction && state && !state.currentStructuredRoot) {
            message = "当前选择不符合任何组件签名。".concat(state.reason);
          }
          if (!message && state) message = state.reason;
          element("selection-constraint").textContent = message || "当前选择没有可执行的组件操作。";
          const structureStatus = element("structure-candidates");
          if (structureStatus) {
            const candidates = semanticAvailability.filter((entry) => entry.canConfigure || entry.canStructure);
            if (semanticBlockedReason) {
              structureStatus.textContent = semanticBlockedReason;
            } else if (candidates.length > 0) {
              const labels = candidates.map((candidate) => {
                const entry = requireEntry(SemanticEntries, candidate.semantic, "组件语义");
                return entry.title.split("/")[0].trim();
              });
              structureStatus.textContent = "可配置：".concat(labels.join("、"), "。");
            } else {
              const structuredState = semanticAvailability.find((entry) => StructuredSemanticNames.includes(entry.semantic) && entry.currentStructuredRoot) || semanticAvailability.find((entry) => StructuredSemanticNames.includes(entry.semantic));
              const reason = structuredState ? structuredState.structureReason || structuredState.reason : "请选择一个代表完整组件的 Photoshop 图层组。";
              structureStatus.textContent = "暂不可结构化：".concat(reason);
            }
          }
        }
        function setSemanticAvailability(entries, preferredSemantic, blockedReason) {
          semanticAvailability = Array.isArray(entries) ? entries.slice() : [];
          semanticBlockedReason = String(blockedReason || "");
          SemanticEntries.forEach((entry) => {
            const state = semanticAvailability.find((candidate) => candidate.semantic === entry.name);
            const option = element("semantic-option-".concat(entry.name));
            if (option) option.disabled = !state || !state.enabled;
          });
          const preferredState = semanticAvailability.find((entry) => entry.semantic === preferredSemantic);
          const registeredPreferred = SemanticEntries.some((entry) => entry.name === preferredSemantic) && preferredState && preferredState.enabled;
          const currentSemantic = element("semantic").value;
          const currentState = semanticAvailability.find((entry) => entry.semantic === currentSemantic);
          const firstEnabled = semanticAvailability.find((entry) => entry.enabled);
          if (preferredSemantic === "" || preferredSemantic === "group" || preferredSemantic === "view") {
            element("semantic").value = "";
          } else if (registeredPreferred) {
            element("semantic").value = preferredSemantic;
          } else if (!currentState || !currentState.enabled) {
            element("semantic").value = firstEnabled ? firstEnabled.semantic : SemanticEntries[0].name;
          }
          updateSemanticOptions();
        }
        function setup() {
          PanelEntries.forEach((entry) => {
            element(entry.tabId).addEventListener("click", () => {
              activatePanel(entry.name);
              if (panelChangeHandler) {
                try {
                  panelChangeHandler(entry.name);
                } catch (error) {
                  console.error("切换到 ".concat(entry.name, " 功能区后刷新 Photoshop 上下文失败。"), error);
                }
              }
            });
          });
          element("status-toggle").addEventListener("click", () => {
            const expanded = element("status-toggle").getAttribute("aria-expanded") === "true";
            setStatusExpanded(!expanded);
          });
          element("advanced-resource-toggle").addEventListener("change", () => {
            setAdvancedResourceVisible(Boolean(element("advanced-resource-toggle").checked));
          });
          const internalToggle = element("internal-settings-toggle");
          if (internalToggle) internalToggle.addEventListener("click", () => {
            setInternalSettingsVisible(internalToggle.getAttribute("aria-expanded") !== "true");
          });
          element("semantic").addEventListener("change", updateSemanticOptions);
          const guideToggle = element("component-guide-toggle");
          if (guideToggle) {
            guideToggle.addEventListener("click", () => {
              const expanded = guideToggle.getAttribute("aria-expanded") !== "true";
              guideToggle.setAttribute("aria-expanded", String(expanded));
              setClassState(element("component-guide-content"), "is-hidden", !expanded);
              element("component-guide-chevron").textContent = expanded ? "−" : "＋";
              renderGuide();
            });
            element("component-guide-kind").addEventListener("change", renderGuide);
          }
        }
        global.Psd2UiPanelShell = {
          PanelEntries,
          SemanticEntries,
          activatePanel,
          setPanelChangeHandler,
          setStatusExpanded,
          setAdvancedResourceVisible,
          setInternalSettingsVisible,
          updateSemanticOptions,
          setSemanticAvailability
        };
        setup();
      })(window);
    }
  });

  // Plus-ins/PSD2UI/generated/core/defaults.js
  var require_defaults = __commonJS({
    "Plus-ins/PSD2UI/generated/core/defaults.js"(exports, module) {
      "use strict";
      var PRESET_VERSION = 1;
      var ENABLED = "enabled";
      var DISABLED = "disabled";
      function color(r, g, b, a) {
        return { r, g, b, a };
      }
      function createPreset(semantic) {
        const common = {
          presetVersion: PRESET_VERSION,
          authoringSource: "explicit",
          exportMode: "runtime",
          structure: null,
          visible: ENABLED,
          opacity: 1,
          rotationClockwiseDegrees: 0
        };
        switch (semantic) {
          case "view":
          case "group":
            return __spreadProps(__spreadValues({}, common), { semantic });
          case "ignore":
            return __spreadProps(__spreadValues({}, common), { semantic, ignoreMode: "subtree" });
          case "image":
            return __spreadProps(__spreadValues({}, common), {
              semantic,
              image: {
                resourceId: null,
                imageType: "simple",
                sliceBorder: null,
                preserveAspect: DISABLED,
                raycast: DISABLED,
                color: color(1, 1, 1, 1)
              }
            });
          case "raw-image":
            return __spreadProps(__spreadValues({}, common), {
              semantic,
              rawImage: {
                resourceId: null,
                uvRect: { x: 0, y: 0, width: 1, height: 1 },
                raycast: DISABLED,
                color: color(1, 1, 1, 1)
              }
            });
          case "text":
            return __spreadProps(__spreadValues({}, common), {
              semantic,
              text: {
                fontKey: "default",
                effects: null,
                value: "",
                fontSize: 24,
                color: color(1, 1, 1, 1),
                alignment: "middle-center",
                richText: ENABLED,
                raycast: DISABLED,
                lineSpacing: 1
              }
            });
          case "button":
            return __spreadProps(__spreadValues({}, common), {
              semantic,
              button: {
                interactable: ENABLED,
                transition: "color-tint"
              }
            });
          case "input-field":
          case "toggle":
          case "list":
          case "grid":
          case "red-point":
          case "toggle-page-group":
          case "list-page-group":
            return __spreadProps(__spreadValues({}, common), { semantic });
          default:
            return null;
        }
      }
      module.exports = {
        PRESET_VERSION,
        ENABLED,
        DISABLED,
        createPreset
      };
    }
  });

  // Plus-ins/PSD2UI/generated/core/ids.js
  var require_ids = __commonJS({
    "Plus-ins/PSD2UI/generated/core/ids.js"(exports, module) {
      "use strict";
      var sequence = 0;
      function createId(prefix) {
        sequence += 1;
        const time = Date.now().toString(36);
        const random = Math.floor(Math.random() * 4294967296).toString(36).padStart(7, "0");
        return "".concat(prefix, "-").concat(time, "-").concat(sequence.toString(36), "-").concat(random);
      }
      module.exports = { createId };
    }
  });

  // Plus-ins/PSD2UI/generated/core/errors.js
  var require_errors = __commonJS({
    "Plus-ins/PSD2UI/generated/core/errors.js"(exports, module) {
      "use strict";
      var Psd2UiError = class extends Error {
        constructor(code, message, details) {
          super(message);
          this.name = "Psd2UiError";
          this.code = code;
          this.details = details || null;
        }
      };
      function fail(code, message, details) {
        throw new Psd2UiError(code, message, details);
      }
      module.exports = { Psd2UiError, fail };
    }
  });

  // Plus-ins/PSD2UI/generated/core/structure.js
  var require_structure = __commonJS({
    "Plus-ins/PSD2UI/generated/core/structure.js"(exports, module) {
      "use strict";
      var { fail } = require_errors();
      var StructuredSemantics = /* @__PURE__ */ new Set([
        "button",
        "input-field",
        "toggle",
        "list",
        "grid",
        "toggle-page-group",
        "list-page-group"
      ]);
      var GroupNames = Object.freeze({
        button: "按钮",
        "input-field": "输入框",
        toggle: "开关",
        list: "列表",
        grid: "网格",
        "toggle-page-group": "页签页面组",
        "list-page-group": "列表页面组"
      });
      var GeometryTolerance = 1;
      function asNumber(value) {
        const result = Number(value);
        return Number.isFinite(result) ? result : 0;
      }
      function geometry(layer) {
        const bounds = layer && layer.bounds || {};
        const left = asNumber(bounds.left);
        const top = asNumber(bounds.top);
        const right = asNumber(bounds.right);
        const bottom = asNumber(bounds.bottom);
        return {
          left,
          top,
          right,
          bottom,
          width: right - left,
          height: bottom - top,
          centerX: (left + right) / 2,
          centerY: (top + bottom) / 2
        };
      }
      function near(left, right) {
        return Math.abs(left - right) <= GeometryTolerance;
      }
      function geometryFailure(code, semantic, requirement, layers) {
        fail(
          code,
          "无法结构化为".concat(GroupNames[semantic], "：要求 ").concat(requirement, "；当前 ").concat(summarize(layers), " 的位置或尺寸不符合。请调整后重试。"),
          { semantic, requirement, actual: summarize(layers) }
        );
      }
      function requireEqualPositiveSize(semantic, layers) {
        const boxes = layers.map(geometry);
        if (boxes.some((box) => box.width <= 0 || box.height <= 0)) {
          geometryFailure("PSD2UI_STRUCTURE_SIZE_INVALID", semantic, "每个条目都具有正的像素宽高", layers);
        }
        const first = boxes[0];
        if (boxes.some((box) => !near(box.width, first.width) || !near(box.height, first.height))) {
          geometryFailure("PSD2UI_STRUCTURE_SIZE_MISMATCH", semantic, "所有条目尺寸一致（允许 1px 误差）", layers);
        }
        return boxes;
      }
      function measuredSpacing(gaps, semantic, layers, axisLabel, diagnostics) {
        const first = gaps[0] || 0;
        if (!gaps.some((value) => !near(value, first))) return Math.max(0, first);
        if (!diagnostics) {
          geometryFailure("PSD2UI_STRUCTURE_SPACING_MISMATCH", semantic, "".concat(axisLabel, "间距一致（允许 1px 误差）"), layers);
        }
        const average = Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length * 100) / 100;
        diagnostics.push({
          code: "PSD2UI_LAYOUT_SPACING_AVERAGED",
          message: "".concat(axisLabel, "间距不一致（").concat(Math.min(...gaps), "–").concat(Math.max(...gaps), "px），已取平均 ").concat(average, "px 作为统一间距。")
        });
        return Math.max(0, average);
      }
      function requireRegularAxis(values, semantic, layers, axisLabel, diagnostics, cellSize) {
        if (values.length <= 1) return 0;
        if (diagnostics) {
          const gaps = values.slice(1).map((value, index) => value - values[index] - cellSize);
          if (gaps.some((gap) => gap < -GeometryTolerance)) {
            geometryFailure("PSD2UI_STRUCTURE_OVERLAP_INVALID", semantic, "相邻格子不重叠", layers);
          }
          return measuredSpacing(gaps, semantic, layers, axisLabel, diagnostics) + cellSize;
        }
        const spacing = values[1] - values[0];
        if (values.slice(2).some((value, index) => !near(value - values[index + 1], spacing))) {
          geometryFailure(
            "PSD2UI_STRUCTURE_SPACING_MISMATCH",
            semantic,
            "".concat(axisLabel, "间距一致（允许 1px 误差）"),
            layers
          );
        }
        return spacing;
      }
      function planListGeometry(layers, diagnostics) {
        const boxes = requireEqualPositiveSize("list", layers);
        const minX = Math.min(...boxes.map((box) => box.centerX));
        const maxX = Math.max(...boxes.map((box) => box.centerX));
        const minY = Math.min(...boxes.map((box) => box.centerY));
        const maxY = Math.max(...boxes.map((box) => box.centerY));
        const horizontal = maxX - minX > GeometryTolerance && maxY - minY <= GeometryTolerance;
        const vertical = maxY - minY > GeometryTolerance && maxX - minX <= GeometryTolerance;
        if (!horizontal && !vertical) {
          geometryFailure(
            "PSD2UI_STRUCTURE_ALIGNMENT_INVALID",
            "list",
            "条目沿单一横轴或纵轴对齐，不能重叠或同时跨两个方向",
            layers
          );
        }
        const ordered = boxes.slice().sort((left, right) => horizontal ? left.left - right.left : left.top - right.top);
        const gaps = ordered.slice(1).map((box, index) => horizontal ? box.left - ordered[index].right : box.top - ordered[index].bottom);
        if (gaps.some((gap) => gap < -GeometryTolerance)) {
          geometryFailure("PSD2UI_STRUCTURE_OVERLAP_INVALID", "list", "相邻条目不重叠", layers);
        }
        if (!diagnostics && gaps.length > 1 && gaps.slice(1).some((gap) => !near(gap, gaps[0]))) {
          geometryFailure("PSD2UI_STRUCTURE_SPACING_MISMATCH", "list", "条目间距一致（允许 1px 误差）", layers);
        }
        return {
          direction: horizontal ? "horizontal" : "vertical",
          itemWidth: boxes[0].width,
          itemHeight: boxes[0].height,
          spacing: diagnostics ? measuredSpacing(gaps, "list", layers, horizontal ? "横向" : "纵向", diagnostics) : Math.max(0, gaps[0] || 0)
        };
      }
      function clusterAxis(values) {
        const sorted = values.slice().sort((left, right) => left - right);
        const clusters = [];
        sorted.forEach((value) => {
          const last = clusters[clusters.length - 1];
          if (!last || !near(last.value, value)) {
            clusters.push({ value, count: 1 });
          } else {
            last.value = (last.value * last.count + value) / (last.count + 1);
            last.count += 1;
          }
        });
        return clusters.map((entry) => entry.value);
      }
      function nearestAxisIndex(value, axis) {
        let best = 0;
        for (let index = 1; index < axis.length; index += 1) {
          if (Math.abs(axis[index] - value) < Math.abs(axis[best] - value)) best = index;
        }
        return best;
      }
      function planGridGeometry(layers, diagnostics) {
        const boxes = requireEqualPositiveSize("grid", layers);
        const columns = clusterAxis(boxes.map((box) => box.centerX));
        const rows = clusterAxis(boxes.map((box) => box.centerY));
        if (columns.length === 1 && rows.length === 1) {
          geometryFailure("PSD2UI_STRUCTURE_OVERLAP_INVALID", "grid", "Cell 不能全部重叠", layers);
        }
        const horizontalStep = requireRegularAxis(columns, "grid", layers, "横向", diagnostics, boxes[0].width);
        const verticalStep = requireRegularAxis(rows, "grid", layers, "纵向", diagnostics, boxes[0].height);
        if (columns.length > 1 && horizontalStep < boxes[0].width - GeometryTolerance || rows.length > 1 && verticalStep < boxes[0].height - GeometryTolerance) {
          geometryFailure("PSD2UI_STRUCTURE_OVERLAP_INVALID", "grid", "相邻 Cell 不重叠", layers);
        }
        const occupied = /* @__PURE__ */ new Set();
        const cellsByRow = /* @__PURE__ */ new Map();
        boxes.forEach((box) => {
          const column = nearestAxisIndex(box.centerX, columns);
          const row = nearestAxisIndex(box.centerY, rows);
          const key = "".concat(row, ":").concat(column);
          if (occupied.has(key)) {
            geometryFailure("PSD2UI_STRUCTURE_OVERLAP_INVALID", "grid", "每个行列位置最多放置一个 Cell", layers);
          }
          occupied.add(key);
          if (!cellsByRow.has(row)) cellsByRow.set(row, []);
          cellsByRow.get(row).push(column);
        });
        if (rows.length > 1 && columns.length > 1) {
          for (let row = 0; row < rows.length; row += 1) {
            const rowColumns = (cellsByRow.get(row) || []).sort((left, right) => left - right);
            const isLast = row === rows.length - 1;
            const hasGap = rowColumns.some((column, index) => column !== index);
            if (rowColumns.length === 0 || hasGap || !isLast && rowColumns.length !== columns.length) {
              geometryFailure(
                "PSD2UI_STRUCTURE_GRID_IRREGULAR",
                "grid",
                "按行连续排列，只有最后一行允许缺少尾部 Cell",
                layers
              );
            }
          }
        }
        return {
          cellWidth: boxes[0].width,
          cellHeight: boxes[0].height,
          columns: columns.length,
          rows: rows.length,
          horizontalSpacing: columns.length > 1 ? Math.max(0, horizontalStep - boxes[0].width) : 0,
          verticalSpacing: rows.length > 1 ? Math.max(0, verticalStep - boxes[0].height) : 0
        };
      }
      function normalizeLayerKind(layer) {
        const raw = String(layer && layer.kind || "").toLowerCase();
        if (raw.includes("text")) return "text";
        if (raw.includes("group") || layer && Array.isArray(layer.children) && layer.children.length > 0) {
          return "group";
        }
        return "image";
      }
      function isGroupLayer(layer) {
        return String(layer && layer.kind || "").toLowerCase().includes("group");
      }
      function summarize(layers) {
        const counts = { image: 0, text: 0, group: 0 };
        layers.forEach((layer) => {
          counts[normalizeLayerKind(layer)] += 1;
        });
        return "".concat(counts.image, " 张图片、").concat(counts.text, " 个文本、").concat(counts.group, " 个组");
      }
      function requireCommonParent(layers, semantic) {
        const parents = new Set(layers.map((layer) => String(layer.parentId == null ? "" : layer.parentId)));
        if (parents.size > 1) {
          fail(
            "PSD2UI_STRUCTURE_PARENT_MISMATCH",
            "无法结构化为".concat(GroupNames[semantic], "：选中图层不在同一个父级。请移动到共同父级后重试。")
          );
        }
      }
      function role(name, layer) {
        return { name, layerId: layerIdOf(layer), nodeId: null };
      }
      function layerIdOf(layer) {
        return String(layer && (layer.layerId == null ? layer.id : layer.layerId) || "").trim();
      }
      var StructureRoleContracts = Object.freeze({
        button: Object.freeze({
          background: { label: "背景", required: true, kinds: ["image"], semantics: ["image", "raw-image"] },
          label: { label: "标题", required: false, kinds: ["text"], semantics: ["text"] }
        }),
        "input-field": Object.freeze({
          background: { label: "背景", required: true, kinds: ["image"], semantics: ["image"] },
          text: { label: "输入文字", required: true, kinds: ["text"], semantics: ["text"] },
          placeholder: { label: "占位文字", required: false, kinds: ["text"], semantics: ["text"] }
        }),
        toggle: Object.freeze({
          background: { label: "背景", required: true, kinds: ["image"], semantics: ["image"] },
          "on-graphic": { label: "选中图形", required: true, kinds: ["image"], semantics: ["image"] },
          label: { label: "标题", required: false, kinds: ["text"], semantics: ["text"] }
        }),
        list: Object.freeze({
          "item-template": { label: "条目模板", required: true, kinds: ["group"], semantics: [] }
        }),
        grid: Object.freeze({
          "cell-template": { label: "格子模板", required: true, kinds: ["group"], semantics: [] }
        }),
        "list-page-group": Object.freeze({
          list: { label: "页面列表", required: true, kinds: ["group"], semantics: ["list"] }
        })
      });
      function structureRoleContract(semantic, name) {
        if (semantic === "toggle-page-group") {
          return /^toggle-(0|[1-9][0-9]*)$/.test(String(name || "")) ? { label: "页签", required: true, kinds: ["group"], semantics: ["toggle"] } : null;
        }
        return StructureRoleContracts[semantic] && StructureRoleContracts[semantic][name] || null;
      }
      function isComponentBoundary(layer) {
        return Boolean(layer && requiresStructure(layer.semantic) && layer.structure && Array.isArray(layer.structure.roles));
      }
      function isWithinComponent(layerId, ownerLayerId, parentById, nodesById) {
        let current = String(parentById[String(layerId)] || "");
        const owner = String(ownerLayerId);
        const visited = /* @__PURE__ */ new Set();
        while (current && !visited.has(current)) {
          if (current === owner) return true;
          if (isComponentBoundary(nodesById[current])) return false;
          visited.add(current);
          current = String(parentById[current] || "");
        }
        return false;
      }
      function collectComponentCandidates(layers) {
        const result = [];
        const seen = /* @__PURE__ */ new Set();
        function visit(layer, path, parentId) {
          const layerId = layerIdOf(layer);
          if (!layerId || seen.has(layerId)) {
            fail("PSD2UI_STRUCTURE_LAYER_ID_INVALID", "组件候选图层缺少唯一的 Photoshop layerId。");
          }
          seen.add(layerId);
          if (layer.semantic === "ignore" || layer.exportMode === "preview-only") return;
          const name = String(layer.name || layerId);
          const candidate = __spreadProps(__spreadValues({}, layer), {
            layerId,
            parentId: parentId == null ? String(layer.parentId == null ? "" : layer.parentId) : String(parentId),
            path: path ? "".concat(path, "/").concat(name) : name
          });
          result.push(candidate);
          if (isComponentBoundary(layer)) return;
          (layer.children || []).filter(Boolean).forEach((child) => visit(child, candidate.path, layerId));
        }
        layers.forEach((layer) => visit(layer, "", null));
        return result;
      }
      function candidateSummary(layer) {
        return {
          layerId: layerIdOf(layer),
          name: String(layer.name || ""),
          kind: normalizeLayerKind(layer),
          semantic: String(layer.semantic || ""),
          parentId: String(layer.parentId == null ? "" : layer.parentId),
          path: layer.path || String(layer.name || "")
        };
      }
      function roleAcceptsLayer(contract, layer) {
        const kind = normalizeLayerKind(layer);
        if (!contract.kinds.includes(kind)) return false;
        if (kind === "group") return contract.semantics.length === 0 || contract.semantics.includes(layer.semantic);
        return !isComponentBoundary(layer);
      }
      function normalizeRoleChoices(options, semantic) {
        const choices = /* @__PURE__ */ new Map();
        if (options.roles != null && !Array.isArray(options.roles)) {
          fail("PSD2UI_STRUCTURE_ROLE_INVALID", "roles 必须是包含 name/layerId 的数组。");
        }
        (options.roles || []).forEach((choice) => {
          const name = String(choice && choice.name || "").trim();
          if (!structureRoleContract(semantic, name) || choices.has(name)) {
            fail("PSD2UI_STRUCTURE_ROLE_INVALID", "组件 ".concat(semantic, " 包含未知或重复角色 '").concat(name, "'。"));
          }
          choices.set(name, String(choice.layerId == null ? "" : choice.layerId).trim());
        });
        if (options.templateLayerId != null) {
          const name = semantic === "list" ? "item-template" : semantic === "grid" ? "cell-template" : "";
          if (!name) fail("PSD2UI_STRUCTURE_TEMPLATE_INVALID", "只有列表或网格可以指定 templateLayerId。");
          const id = String(options.templateLayerId).trim();
          if (choices.has(name) && choices.get(name) !== id) {
            fail("PSD2UI_STRUCTURE_TEMPLATE_INVALID", "模板角色与 templateLayerId 指向不同图层。");
          }
          choices.set(name, id);
        }
        return choices;
      }
      function describeRoles(semantic, candidates, options) {
        const choices = normalizeRoleChoices(options, semantic);
        const explicitRoles = Array.isArray(options.roles);
        let names = Object.keys(StructureRoleContracts[semantic] || {});
        if (semantic === "toggle-page-group") {
          const toggles = candidates.filter((layer) => normalizeLayerKind(layer) === "group" && layer.semantic === "toggle");
          names = choices.size ? [...choices.keys()].sort((a, b) => Number(a.slice(7)) - Number(b.slice(7))) : toggles.map((_layer, index) => "toggle-".concat(index));
          if (names.length === 0) names = ["toggle-0"];
        }
        const occupied = new Set([...choices.values()].filter(Boolean));
        const roles = names.map((name) => {
          const contract = structureRoleContract(semantic, name);
          const matching = candidates.filter((layer) => roleAcceptsLayer(contract, layer));
          const selectable = matching.filter((layer) => !occupied.has(layerIdOf(layer)) || choices.get(name) === layerIdOf(layer));
          const selectedLayerId = choices.has(name) ? choices.get(name) : explicitRoles && !contract.required ? "" : selectable.length === 1 ? layerIdOf(selectable[0]) : "";
          if (selectedLayerId) occupied.add(selectedLayerId);
          return {
            name,
            label: contract.label,
            required: contract.required,
            candidates: matching.map(candidateSummary),
            selectedLayerId,
            explicit: choices.has(name) || explicitRoles && !contract.required,
            ambiguous: !choices.has(name) && !(explicitRoles && !contract.required) && selectable.length > 1
          };
        });
        return roles;
      }
      function requireStructuredGroupRoot(semantic, groupRoot) {
        if (!groupRoot || !isGroupLayer(groupRoot)) {
          fail(
            "PSD2UI_STRUCTURE_ROOT_GROUP_REQUIRED",
            "无法结构化为".concat(GroupNames[semantic], "：必须只选择 1 个现有 Photoshop 组作为组件根。") + "请先在 Photoshop 图层面板中建立组，再选择该组。"
          );
        }
        const rootLayerId = layerIdOf(groupRoot);
        if (!rootLayerId) {
          fail("PSD2UI_STRUCTURE_ROOT_LAYER_ID_REQUIRED", "结构化组件组根缺少 Photoshop layerId。");
        }
        const rootName = String(groupRoot.name || "").trim();
        if (!rootName) {
          fail("PSD2UI_STRUCTURE_ROOT_NAME_REQUIRED", "结构化为".concat(GroupNames[semantic], "的 Photoshop 组不能为空名。"));
        }
        const children = Array.isArray(groupRoot.children) ? groupRoot.children.filter(Boolean) : [];
        if (children.length === 0) {
          fail(
            "PSD2UI_STRUCTURE_ROOT_EMPTY",
            "无法结构化为".concat(GroupNames[semantic], "：组根 '").concat(rootName, "' 没有直属子图层。")
          );
        }
        const rootGeometry = geometry(groupRoot);
        if (rootGeometry.width <= 0 || rootGeometry.height <= 0) {
          fail(
            "PSD2UI_STRUCTURE_ROOT_BOUNDS_INVALID",
            "无法结构化为".concat(GroupNames[semantic], "：组根 '").concat(rootName, "' 必须具有正的像素宽高；") + "当前为 ".concat(rootGeometry.width, " × ").concat(rootGeometry.height, "。请检查组内可见内容和图层边界。"),
            { layerId: rootLayerId, bounds: groupRoot.bounds || null }
          );
        }
        const nonDirectChild = children.find((child) => String(child.parentId == null ? "" : child.parentId) !== rootLayerId);
        if (nonDirectChild) {
          fail(
            "PSD2UI_STRUCTURE_ROOT_CHILD_INVALID",
            "无法结构化为".concat(GroupNames[semantic], "：图层 ").concat(nonDirectChild.layerId || "<empty>", " 不是组根 '").concat(rootName, "' 的直属子图层。")
          );
        }
        return { rootLayerId, rootName, children };
      }
      function planStructuredGroup(semantic, groupRoot, options) {
        const normalizedSemantic = String(semantic || "").trim();
        if (!StructuredSemantics.has(normalizedSemantic)) {
          fail("PSD2UI_STRUCTURE_SEMANTIC_REQUIRED", "语义 '".concat(normalizedSemantic, "' 不支持结构化。"));
        }
        const root = requireStructuredGroupRoot(normalizedSemantic, groupRoot);
        const plan = planStructure(normalizedSemantic, root.children, options);
        return __spreadProps(__spreadValues({}, plan), {
          rootLayerId: root.rootLayerId,
          groupName: root.rootName
        });
      }
      function planCollectionLayout(semantic, samples) {
        if (!Array.isArray(samples) || samples.length < 2) {
          fail("PSD2UI_STRUCTURE_LAYOUT_REQUIRED", "只有一个模板时，请明确填写方向、尺寸与间距等布局参数。");
        }
        return semantic === "list" ? planListGeometry(samples) : planGridGeometry(samples);
      }
      function suggestCollectionLayout(semantic, samples) {
        if (!["list", "grid"].includes(semantic) || !Array.isArray(samples) || samples.length < 2) {
          fail("PSD2UI_STRUCTURE_LAYOUT_REQUIRED", "自动计算间距需要至少两个格子或条目组。");
        }
        const diagnostics = [];
        const layout = semantic === "list" ? planListGeometry(samples, diagnostics) : planGridGeometry(samples, diagnostics);
        return { layout, diagnostics };
      }
      function validateTemplateSize(semantic, layout, template) {
        validateStructureLayout(semantic, layout);
        const box = geometry(template);
        const width = semantic === "list" ? layout.itemWidth : layout.cellWidth;
        const height = semantic === "list" ? layout.itemHeight : layout.cellHeight;
        if (Math.abs(width - box.width) > 0.01 || Math.abs(height - box.height) > 0.01) {
          fail("PSD2UI_STRUCTURE_LAYOUT_STALE", "模板尺寸与已记录布局不一致，请重新配置模板或布局。");
        }
      }
      function planStructure(semantic, selectedLayers, options) {
        const normalizedSemantic = String(semantic || "").trim();
        if (!StructuredSemantics.has(normalizedSemantic)) {
          fail("PSD2UI_STRUCTURE_SEMANTIC_REQUIRED", "语义 '".concat(normalizedSemantic, "' 不支持结构化。"));
        }
        const layers = Array.isArray(selectedLayers) ? selectedLayers.filter(Boolean) : [];
        if (layers.length === 0) {
          fail("PSD2UI_STRUCTURE_SELECTION_REQUIRED", "结构化为".concat(GroupNames[normalizedSemantic], "前必须选择图层。"));
        }
        requireCommonParent(layers, normalizedSemantic);
        const settings = options || {};
        const candidates = collectComponentCandidates(layers);
        const described = describeRoles(normalizedSemantic, candidates, settings);
        const roles = [];
        const usedIds = /* @__PURE__ */ new Set();
        described.forEach((entry) => {
          if (entry.ambiguous) {
            fail(
              "PSD2UI_STRUCTURE_ROLE_AMBIGUOUS",
              "".concat(GroupNames[normalizedSemantic], "的“").concat(entry.label, "”有多个候选，请明确选择角色图层。"),
              { semantic: normalizedSemantic, roleName: entry.name, candidates: entry.candidates }
            );
          }
          if (!entry.selectedLayerId) {
            if (entry.required) {
              fail(
                "PSD2UI_STRUCTURE_ROLE_REQUIRED",
                "".concat(GroupNames[normalizedSemantic], "缺少“").concat(entry.label, "”角色，请选择对应图层。"),
                { semantic: normalizedSemantic, roleName: entry.name, candidates: entry.candidates }
              );
            }
            return;
          }
          const target = candidates.find((layer) => layerIdOf(layer) === entry.selectedLayerId);
          if (!target || !entry.candidates.some((candidate) => candidate.layerId === entry.selectedLayerId)) {
            fail("PSD2UI_STRUCTURE_ROLE_SCOPE_INVALID", "角色 '".concat(entry.name, "' 必须指向当前组件内类型匹配的图层，不能穿越另一个组件。"));
          }
          if (usedIds.has(entry.selectedLayerId)) {
            fail("PSD2UI_STRUCTURE_ROLE_DUPLICATE", "图层 ".concat(entry.selectedLayerId, " 不能同时占用多个组件角色，请明确选择。"));
          }
          usedIds.add(entry.selectedLayerId);
          roles.push(role(entry.name, target));
        });
        if (normalizedSemantic === "toggle-page-group") {
          roles.forEach((entry, index) => {
            if (entry.name !== "toggle-".concat(index)) {
              fail("PSD2UI_STRUCTURE_ROLE_INVALID", "页签角色必须从 toggle-0 连续编号，顺序由明确角色配置决定。");
            }
          });
        }
        if (settings.previewLayerIds != null && !Array.isArray(settings.previewLayerIds)) {
          fail("PSD2UI_STRUCTURE_PREVIEW_INVALID", "previewLayerIds 必须是数组。");
        }
        const previewLayerIds = (settings.previewLayerIds || []).map((id) => String(id).trim());
        if (new Set(previewLayerIds).size !== previewLayerIds.length) {
          fail("PSD2UI_STRUCTURE_PREVIEW_INVALID", "预览样例不能重复。");
        }
        let layout = null;
        if (normalizedSemantic === "list" || normalizedSemantic === "grid") {
          const templateId = roles[0].layerId;
          const template = candidates.find((layer) => layerIdOf(layer) === templateId);
          const samples = [template];
          previewLayerIds.forEach((id) => {
            const sample = candidates.find((layer) => layerIdOf(layer) === id);
            if (!sample || normalizeLayerKind(sample) !== "group" || id === templateId || String(sample.parentId) !== String(template.parentId)) {
              fail("PSD2UI_STRUCTURE_PREVIEW_INVALID", "预览样例必须是模板的同级组，不能包含模板本身或跨越另一组件。");
            }
            samples.push(sample);
          });
          layout = settings.layout ? JSON.parse(JSON.stringify(settings.layout)) : planCollectionLayout(normalizedSemantic, samples);
          validateTemplateSize(normalizedSemantic, layout, template);
        } else if (previewLayerIds.length || settings.layout != null) {
          fail("PSD2UI_STRUCTURE_PREVIEW_INVALID", "只有列表或网格支持模板预览与集合布局。");
        }
        const structure = {
          version: 1,
          roles,
          previewLayerIds
        };
        if (layout) {
          structure.layout = layout;
          structure.layoutSource = settings.layout ? "explicit" : "inferred";
        }
        return {
          semantic: normalizedSemantic,
          groupName: GroupNames[normalizedSemantic],
          structure
        };
      }
      function describeStructuredSelection(semantic, selectedLayers, options) {
        if (!requiresStructure(semantic)) fail("PSD2UI_STRUCTURE_SEMANTIC_REQUIRED", "语义 '".concat(semantic, "' 不支持结构化。"));
        const layers = Array.isArray(selectedLayers) ? selectedLayers.filter(Boolean) : [];
        if (!layers.length) fail("PSD2UI_STRUCTURE_SELECTION_REQUIRED", "请先选择现有组，或需要组合的同级图层。");
        const existingRoot = layers.length === 1 && isGroupLayer(layers[0]);
        if (!existingRoot && layers.length < 2) {
          fail("PSD2UI_STRUCTURE_ROOT_GROUP_REQUIRED", "组合组件需要现有组或至少两个同级图层。");
        }
        requireCommonParent(layers, semantic);
        const root = existingRoot ? requireStructuredGroupRoot(semantic, layers[0]) : null;
        const members = existingRoot ? root.children : layers;
        const candidates = collectComponentCandidates(members);
        const settings = options || {};
        const roles = describeRoles(semantic, candidates, settings);
        let plan = null;
        let issues = [];
        try {
          plan = planStructure(semantic, members, settings);
        } catch (error) {
          issues = [__spreadValues({ code: error.code || "PSD2UI_STRUCTURE_INVALID", message: error.message }, error.details || {})];
        }
        return {
          semantic,
          requiresGroup: !existingRoot,
          rootLayerId: root && root.rootLayerId || null,
          groupName: root ? root.rootName : String(settings.groupName || GroupNames[semantic]),
          sourceLayerIds: layers.map(layerIdOf),
          parentLayerId: String(layers[0].parentId == null ? "" : layers[0].parentId),
          roles,
          previewCandidates: candidates.filter((layer) => normalizeLayerKind(layer) === "group").map(candidateSummary),
          layout: plan && plan.structure.layout || settings.layout || null,
          needsConfiguration: issues.length > 0,
          issues
        };
      }
      function planStructuredSelection(semantic, selectedLayers, options) {
        const described = describeStructuredSelection(semantic, selectedLayers, options);
        const layers = selectedLayers.filter(Boolean);
        const plan = described.requiresGroup ? planStructure(semantic, layers, options) : planStructuredGroup(semantic, layers[0], options);
        return __spreadProps(__spreadValues({}, plan), {
          rootLayerId: described.rootLayerId,
          requiresGroup: described.requiresGroup,
          sourceLayerIds: described.sourceLayerIds,
          parentLayerId: described.parentLayerId,
          groupName: described.groupName
        });
      }
      function validateVisualStates(value) {
        if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.states) || value.states.length === 0) {
          fail("PSD2UI_VISUAL_STATES_INVALID", "状态配置需要默认状态及至少一个状态组。");
        }
        const names = /* @__PURE__ */ new Set();
        const ids = /* @__PURE__ */ new Set();
        value.states.forEach((state) => {
          const name = String(state && state.name || "").trim();
          const id = String(state && state.layerId || "").trim();
          if (!name || !id || names.has(name) || ids.has(id)) {
            fail("PSD2UI_VISUAL_STATES_INVALID", "状态名和状态组必须非空且不能重复。");
          }
          names.add(name);
          ids.add(id);
        });
        if (!names.has(String(value.defaultState || "").trim())) {
          fail("PSD2UI_VISUAL_STATES_INVALID", "默认状态必须指向已配置的状态名。");
        }
        return {
          defaultState: String(value.defaultState).trim(),
          states: value.states.map((state) => ({ name: String(state.name).trim(), layerId: String(state.layerId).trim() }))
        };
      }
      function planVisualStates(groupRoot, value) {
        const root = requireStructuredGroupRoot("button", groupRoot);
        const result = validateVisualStates(value);
        const candidates = collectComponentCandidates(root.children);
        const byId = new Map(candidates.map((candidate) => [layerIdOf(candidate), candidate]));
        const stateIds = new Set(result.states.map((state) => state.layerId));
        result.states.forEach((state) => {
          const candidate = byId.get(state.layerId);
          if (!candidate || !isGroupLayer(candidate)) {
            fail("PSD2UI_VISUAL_STATE_SCOPE_INVALID", "状态 '".concat(state.name, "' 必须指向当前组件内的组，不能穿越其他组件。"));
          }
          let parentId = candidate.parentId;
          const visited = /* @__PURE__ */ new Set();
          while (byId.has(parentId) && !visited.has(parentId)) {
            if (stateIds.has(parentId)) fail("PSD2UI_VISUAL_STATE_OVERLAP", "不同状态组不能互相嵌套。");
            visited.add(parentId);
            parentId = byId.get(parentId).parentId;
          }
        });
        return result;
      }
      function requiresStructure(semantic) {
        return StructuredSemantics.has(String(semantic || ""));
      }
      function validateStructureLayout(semantic, layout) {
        const list = semantic === "list";
        const keys = list ? ["direction", "itemWidth", "itemHeight", "spacing"] : ["cellWidth", "cellHeight", "columns", "rows", "horizontalSpacing", "verticalSpacing"];
        if (!["list", "grid"].includes(semantic) || !layout || typeof layout !== "object" || Array.isArray(layout) || Object.keys(layout).length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(layout, key))) {
          fail("PSD2UI_STRUCTURE_LAYOUT_INVALID", "".concat(semantic, " 必须包含完整且无额外字段的 structure.layout。"));
        }
        const positive = list ? ["itemWidth", "itemHeight"] : ["cellWidth", "cellHeight"];
        const nonnegative = list ? ["spacing"] : ["horizontalSpacing", "verticalSpacing"];
        if (positive.some((key) => !Number.isFinite(layout[key]) || layout[key] <= 0) || nonnegative.some((key) => !Number.isFinite(layout[key]) || layout[key] < 0) || list && !["horizontal", "vertical"].includes(layout.direction) || !list && ["rows", "columns"].some((key) => !Number.isInteger(layout[key]) || layout[key] < 1)) {
          fail("PSD2UI_STRUCTURE_LAYOUT_INVALID", "".concat(semantic, " 布局尺寸必须为正数、间距非负，方向或行列数必须有效。"));
        }
        return layout;
      }
      module.exports = {
        StructuredSemantics,
        isGroupLayer,
        normalizeLayerKind,
        StructureRoleContracts,
        structureRoleContract,
        isComponentBoundary,
        isWithinComponent,
        collectComponentCandidates,
        describeStructuredSelection,
        planStructuredSelection,
        planStructuredGroup,
        planStructure,
        planCollectionLayout,
        suggestCollectionLayout,
        validateTemplateSize,
        validateVisualStates,
        planVisualStates,
        requiresStructure,
        validateStructureLayout
      };
    }
  });

  // Plus-ins/PSD2UI/generated/core/naming.js
  var require_naming = __commonJS({
    "Plus-ins/PSD2UI/generated/core/naming.js"(exports, module) {
      "use strict";
      var EnglishNodeNamePattern = /^[A-Za-z][A-Za-z0-9_]*$/;
      var ResourceBaseNamePattern = /^[a-z][a-z0-9]*(?:_[A-Za-z0-9]+)+$/;
      function stripLegacyLayerSuffix(value) {
        return String(value == null ? "" : value).split("@", 1)[0].trim();
      }
      function parseResourceLayerName(value, layerId) {
        const baseName = stripLegacyLayerSuffix(value);
        if (!ResourceBaseNamePattern.test(baseName)) {
          const { fail } = require_errors();
          fail(
            "PSD2UI_IMAGE_NAME_INVALID",
            "图片图层 ".concat(layerId == null ? "" : layerId, " '").concat(String(value || ""), "' 命名无效；") + "基础名须为小写资源分组前缀及下划线分隔的英文字母/数字，例如 comm_sp_0017、comm_bt_0032、i_diamond_small。",
            { layerId: String(layerId == null ? "" : layerId), name: String(value || ""), baseName }
          );
        }
        return { baseName, fileName: "".concat(baseName, ".png"), group: baseName.split("_")[0] };
      }
      function collectInvalidImageLayerNames(snapshot, manifest) {
        const { normalizeLayerKind } = require_structure();
        const issues = [];
        const previews = /* @__PURE__ */ new Set();
        function visit(layer, path, isRoot) {
          if (!layer) return;
          const layerId = String(layer.layerId == null ? "" : layer.layerId);
          const node = manifest && manifest.nodes && manifest.nodes[layerId];
          if (previews.has(layerId) || node && (node.semantic === "ignore" || node.exportMode === "preview-only")) return;
          if (node && node.structure && node.structure.previewLayerIds) {
            let collect = function(child) {
              descendants.add(String(child.layerId));
              (child.children || []).forEach(collect);
            };
            const descendants = /* @__PURE__ */ new Set();
            (layer.children || []).forEach(collect);
            node.structure.previewLayerIds.forEach((id) => {
              if (descendants.has(String(id))) previews.add(String(id));
            });
          }
          if (!isRoot && normalizeLayerKind(layer) === "image") {
            try {
              parseResourceLayerName(layer.name, layerId);
            } catch (error) {
              issues.push({
                severity: "error",
                code: error.code,
                message: error.message,
                layerId,
                name: String(layer.name || ""),
                path: "".concat(path, ".name")
              });
            }
          }
          (layer.children || []).forEach((child, index) => visit(child, "".concat(path, ".children[").concat(index, "]"), false));
        }
        visit(snapshot && snapshot.root, "root", true);
        return issues;
      }
      function isEnglishNodeName(value) {
        return EnglishNodeNamePattern.test(String(value || "").trim());
      }
      function collectInvalidLayerNames(snapshot) {
        const invalid = [];
        function visit(layer) {
          if (!layer) return;
          const name = String(layer.name || "").trim();
          if (!isEnglishNodeName(name)) {
            invalid.push({
              layerId: String(layer.layerId == null ? "" : layer.layerId),
              name
            });
          }
          (layer.children || []).forEach(visit);
        }
        visit(snapshot && snapshot.root);
        return invalid;
      }
      function resolveNodeName(node, photoshopLayerName) {
        const fallback = stripLegacyLayerSuffix(photoshopLayerName || node && node.name || "");
        return fallback;
      }
      function applyManifestNodeNames(manifest, snapshot) {
        const nodes = manifest && manifest.nodes || {};
        const layers = [];
        function collect(layer) {
          if (!layer) return;
          layers.push(layer);
          (layer.children || []).forEach(collect);
        }
        collect(snapshot && snapshot.root);
        layers.forEach((layer) => {
          const node = nodes[String(layer.layerId)];
          if (node) {
            node.name = stripLegacyLayerSuffix(layer.name || node.name || "Layer-".concat(layer.layerId));
          }
        });
        return manifest;
      }
      module.exports = {
        ResourceBaseNamePattern,
        stripLegacyLayerSuffix,
        parseResourceLayerName,
        collectInvalidImageLayerNames,
        isEnglishNodeName,
        collectInvalidLayerNames,
        resolveNodeName,
        applyManifestNodeNames
      };
    }
  });

  // Plus-ins/PSD2UI/generated/core/resourceRegistry.js
  var require_resourceRegistry = __commonJS({
    "Plus-ins/PSD2UI/generated/core/resourceRegistry.js"(exports, module) {
      "use strict";
      var { fail } = require_errors();
      var { createId } = require_ids();
      var { parseResourceLayerName } = require_naming();
      var ResourceKinds = Object.freeze({
        SPRITE: "sprite",
        TEXTURE: "texture"
      });
      function normalizeLayerId(layerId) {
        const value = String(layerId == null ? "" : layerId).trim();
        if (!value) {
          fail("PSD2UI_LAYER_ID_REQUIRED", "资源操作必须提供 Photoshop 图层 ID。");
        }
        return value;
      }
      function normalizeModule(moduleName) {
        const value = String(moduleName || "").trim().toLowerCase();
        if (!/^[a-z][a-z0-9_-]*$/.test(value)) {
          fail(
            "PSD2UI_MODULE_INVALID",
            "module '".concat(moduleName || "", "' 无效；必须以小写字母开头，且只包含小写字母、数字、下划线或连字符。")
          );
        }
        return value;
      }
      function normalizeSubmodule(submoduleName) {
        const value = String(submoduleName || "").trim().toLowerCase();
        if (!/^[a-z][a-z0-9]*$/.test(value)) {
          fail(
            "PSD2UI_SUBMODULE_INVALID",
            "submodule '".concat(submoduleName || "", "' 无效；必须以小写字母开头，且只包含小写字母和数字。")
          );
        }
        return value;
      }
      function normalizeKind(kind) {
        const value = String(kind || "").trim().toLowerCase();
        if (value !== ResourceKinds.SPRITE && value !== ResourceKinds.TEXTURE) {
          fail("PSD2UI_RESOURCE_KIND_INVALID", "资源类型 '".concat(kind || "", "' 无效；只允许 sprite 或 texture。"));
        }
        return value;
      }
      function ensureRegistry(manifest) {
        if (!manifest.resourceRegistry) {
          manifest.resourceRegistry = {
            counters: {},
            resources: {},
            layerBindings: {}
          };
        }
        manifest.resourceRegistry.counters = manifest.resourceRegistry.counters || {};
        manifest.resourceRegistry.resources = manifest.resourceRegistry.resources || {};
        manifest.resourceRegistry.layerBindings = manifest.resourceRegistry.layerBindings || {};
        return manifest.resourceRegistry;
      }
      function counterKey(moduleName, kind, submodule) {
        return submodule ? "".concat(moduleName, "|").concat(submodule, "|").concat(kind) : "".concat(moduleName, "|").concat(kind);
      }
      function formatFileName(moduleName, kind, number, submodule) {
        if (!Number.isInteger(number) || number < 1 || number > 9999) {
          const scope = submodule ? "".concat(moduleName, "/").concat(submodule, "/").concat(kind) : "".concat(moduleName, "/").concat(kind);
          fail("PSD2UI_RESOURCE_NUMBER_EXHAUSTED", "".concat(scope, " 的四位资源编号已耗尽。"));
        }
        const token = kind === ResourceKinds.SPRITE ? "sp" : "tex";
        const ownerModule = normalizeModule(moduleName);
        const prefix = submodule ? "".concat(ownerModule, "_").concat(normalizeSubmodule(submodule)) : ownerModule;
        return "".concat(prefix, "_").concat(token, "_").concat(String(number).padStart(4, "0"), ".png");
      }
      function documentSubmodule(manifest) {
        const value = manifest && manifest.document && manifest.document.submodule;
        return value ? normalizeSubmodule(value) : null;
      }
      function allocateNumber(registry, moduleName, kind, submodule) {
        const key = counterKey(moduleName, kind, submodule);
        const next = Number.isInteger(registry.counters[key]) ? registry.counters[key] : 1;
        registry.counters[key] = next + 1;
        return next;
      }
      function formatManifestResourceFileName(manifest, kind, number, resourceModule, resourceSubmodule) {
        const manifestSubmodule = documentSubmodule(manifest);
        return formatFileName(
          normalizeModule(resourceModule || manifest.document.module),
          kind,
          number,
          manifestSubmodule ? normalizeSubmodule(resourceSubmodule) : null
        );
      }
      function getResourceByLayer(manifest, layerId) {
        const registry = ensureRegistry(manifest);
        const resourceId = registry.layerBindings[normalizeLayerId(layerId)];
        return resourceId ? registry.resources[resourceId] || null : null;
      }
      function allocateResource(manifest, input, options) {
        if (manifest.resourceNaming === "source") return allocateSourceResource(manifest, input, options);
        const registry = ensureRegistry(manifest);
        const layerId = normalizeLayerId(input.layerId);
        const kind = normalizeKind(input.kind);
        const moduleName = normalizeModule(input.module || manifest.document.module);
        const manifestSubmodule = documentSubmodule(manifest);
        const submodule = manifestSubmodule ? normalizeSubmodule(input.submodule || manifest.document.submodule) : null;
        const existing = getResourceByLayer(manifest, layerId);
        if (existing) {
          if (existing.status !== "active") {
            fail("PSD2UI_RESOURCE_RETIRED", "图层 ".concat(layerId, " 绑定的资源已停用，不能隐式恢复。"));
          }
          if (existing.kind !== kind || existing.module !== moduleName || manifestSubmodule && existing.submodule !== submodule) {
            fail(
              "PSD2UI_RESOURCE_MIGRATION_REQUIRED",
              "图层 ".concat(layerId, " 已绑定 ").concat(existing.fileName, "；改变 module 或类型必须执行显式迁移。")
            );
          }
          return existing;
        }
        const number = allocateNumber(registry, moduleName, kind, submodule);
        const idFactory = options && options.idFactory ? options.idFactory : createId;
        const resourceId = idFactory("resource");
        if (!resourceId || registry.resources[resourceId]) {
          fail("PSD2UI_RESOURCE_ID_COLLISION", "无法分配唯一的资源 ID。");
        }
        const resource = __spreadProps(__spreadValues({
          id: resourceId,
          kind,
          scope: moduleName === "common" ? "common" : "module",
          module: moduleName
        }, submodule ? { submodule } : {}), {
          number,
          fileName: formatManifestResourceFileName(manifest, kind, number, moduleName, submodule),
          status: "active",
          sourceLayerId: layerId,
          history: []
        });
        registry.resources[resourceId] = resource;
        registry.layerBindings[layerId] = resourceId;
        return resource;
      }
      function allocateSourceResource(manifest, input, options) {
        const registry = ensureRegistry(manifest);
        const layerId = normalizeLayerId(input.layerId);
        const kind = normalizeKind(input.kind);
        const node = manifest.nodes && manifest.nodes[layerId];
        const parsed = parseResourceLayerName(input.layerName == null ? node && node.name : input.layerName, layerId);
        let existing = getResourceByLayer(manifest, layerId);
        if (existing && existing.status !== "active") {
          fail("PSD2UI_RESOURCE_RETIRED", "图层 ".concat(layerId, " 绑定的资源已停用。"));
        }
        if (existing && existing.fileName === parsed.fileName && existing.kind === kind) {
          existing.module = parsed.group;
          existing.scope = "module";
          delete existing.submodule;
          return existing;
        }
        const sourceCandidates = options && options.sourceCandidates;
        function currentSources(resource2) {
          if (!sourceCandidates) return null;
          return Object.keys(registry.layerBindings).filter((id2) => {
            const candidate = sourceCandidates[id2];
            return registry.layerBindings[id2] === resource2.id && candidate && parseResourceLayerName(candidate.layerName, id2).fileName.toLowerCase() === parsed.fileName.toLowerCase();
          }).map((id2) => __spreadValues({ layerId: id2 }, sourceCandidates[id2]));
        }
        const collision = Object.values(registry.resources).find((resource2) => resource2 && resource2.status === "active" && resource2.id !== (existing && existing.id) && String(resource2.fileName || "").toLowerCase() === parsed.fileName.toLowerCase() && (!sourceCandidates || currentSources(resource2).length > 0));
        const conflictingKind = collision && (sourceCandidates ? currentSources(collision).some((candidate) => candidate.kind !== kind) : collision.kind !== kind);
        if (collision && (conflictingKind || collision.fileName !== parsed.fileName)) {
          fail(
            "PSD2UI_RESOURCE_NAME_CONFLICT",
            "图片图层 ".concat(layerId, " 与 ").concat(collision.sourceLayerId, " 的资源 '").concat(parsed.fileName, "' 大小写或图片类型冲突。"),
            { layerId, otherLayerId: collision.sourceLayerId, fileName: parsed.fileName }
          );
        }
        if (existing) {
          const others = Object.keys(registry.layerBindings).filter((id2) => id2 !== layerId && registry.layerBindings[id2] === existing.id);
          const conflictingOther = others.find((id2) => !sourceCandidates || sourceCandidates[id2] && parseResourceLayerName(sourceCandidates[id2].layerName, id2).fileName === parsed.fileName && sourceCandidates[id2].kind !== kind);
          if (conflictingOther && existing.fileName === parsed.fileName && existing.kind !== kind) {
            fail(
              "PSD2UI_RESOURCE_NAME_CONFLICT",
              "图片图层 ".concat(layerId, " 与 ").concat(conflictingOther, " 共享 '").concat(parsed.fileName, "'，但图片类型不一致。"),
              { layerId, otherLayerId: conflictingOther, fileName: parsed.fileName }
            );
          }
          const sharedTypeChange = existing.fileName === parsed.fileName && sourceCandidates && others.every((id2) => sourceCandidates[id2] && sourceCandidates[id2].kind === kind && parseResourceLayerName(sourceCandidates[id2].layerName, id2).fileName === parsed.fileName);
          if ((!others.length || sharedTypeChange) && !collision) {
            existing.history = existing.history || [];
            existing.history.push({
              fileName: existing.fileName,
              module: existing.module,
              kind: existing.kind,
              number: existing.number,
              reason: "source-layer-edited"
            });
            existing.fileName = parsed.fileName;
            existing.module = parsed.group;
            existing.scope = "module";
            existing.kind = kind;
            delete existing.submodule;
            return existing;
          }
          delete registry.layerBindings[layerId];
          if (!others.length) existing.status = "retired";
          else if (String(existing.sourceLayerId) === layerId) existing.sourceLayerId = others[0];
          existing = null;
        }
        if (collision) {
          collision.module = parsed.group;
          collision.scope = "module";
          collision.kind = kind;
          delete collision.submodule;
          registry.layerBindings[layerId] = collision.id;
          return collision;
        }
        const idFactory = options && options.idFactory ? options.idFactory : createId;
        const id = idFactory("resource");
        if (!id || registry.resources[id]) fail("PSD2UI_RESOURCE_ID_COLLISION", "无法分配唯一的资源 ID。");
        const resource = {
          id,
          kind,
          scope: "module",
          module: parsed.group,
          number: allocateNumber(registry, parsed.group, kind, null),
          fileName: parsed.fileName,
          status: "active",
          sourceLayerId: layerId,
          history: []
        };
        registry.resources[id] = resource;
        registry.layerBindings[layerId] = id;
        return resource;
      }
      function reuseResource(manifest, input) {
        const registry = ensureRegistry(manifest);
        const layerId = normalizeLayerId(input.layerId);
        const resource = registry.resources[String(input.resourceId || "")];
        if (!resource || resource.status !== "active") {
          fail("PSD2UI_RESOURCE_NOT_FOUND", "找不到可复用资源 '".concat(input.resourceId || "", "'。"));
        }
        const existing = getResourceByLayer(manifest, layerId);
        if (existing && existing.id !== resource.id) {
          fail(
            "PSD2UI_LAYER_RESOURCE_STABLE",
            "图层 ".concat(layerId, " 已绑定 ").concat(existing.fileName, "；普通迭代不能通过复用命令改变既有资源名称。")
          );
        }
        registry.layerBindings[layerId] = resource.id;
        return resource;
      }
      function retireResource(manifest, input) {
        const registry = ensureRegistry(manifest);
        const resource = registry.resources[String(input.resourceId || "")];
        if (!resource || resource.status !== "active") {
          fail("PSD2UI_RESOURCE_NOT_FOUND", "找不到可停用资源 '".concat(input.resourceId || "", "'。"));
        }
        resource.status = "retired";
        Object.keys(registry.layerBindings).forEach((layerId) => {
          if (registry.layerBindings[layerId] === resource.id) {
            delete registry.layerBindings[layerId];
          }
        });
        return resource;
      }
      function migrateResource(manifest, input) {
        const registry = ensureRegistry(manifest);
        const resource = registry.resources[String(input.resourceId || "")];
        if (!resource || resource.status !== "active") {
          fail("PSD2UI_RESOURCE_NOT_FOUND", "找不到可迁移资源 '".concat(input.resourceId || "", "'。"));
        }
        if (manifest.resourceNaming === "source") {
          const parsed = parseResourceLayerName(resource.fileName.replace(/\.png$/, ""), resource.sourceLayerId);
          if (input.module && input.module !== parsed.group) {
            fail("PSD2UI_SOURCE_RESOURCE_RENAME_REQUIRED", "资源分组来自图片基础名首段；请先修改美术图片名。");
          }
          resource.kind = normalizeKind(input.kind || resource.kind);
          return resource;
        }
        const targetModule = normalizeModule(input.module);
        const targetKind = normalizeKind(input.kind);
        const manifestSubmodule = documentSubmodule(manifest);
        const targetSubmodule = manifestSubmodule ? normalizeSubmodule(
          input.submodule || (targetModule === normalizeModule(manifest.document.module) ? manifest.document.submodule : null)
        ) : null;
        if (resource.module === targetModule && resource.kind === targetKind && (!manifestSubmodule || resource.submodule === targetSubmodule)) {
          return resource;
        }
        resource.history.push(__spreadProps(__spreadValues({
          module: resource.module
        }, resource.submodule ? { submodule: resource.submodule } : {}), {
          kind: resource.kind,
          number: resource.number,
          fileName: resource.fileName,
          reason: String(input.reason || "explicit-migration")
        }));
        const number = allocateNumber(registry, targetModule, targetKind, targetSubmodule);
        resource.module = targetModule;
        if (targetSubmodule) resource.submodule = targetSubmodule;
        else delete resource.submodule;
        resource.kind = targetKind;
        resource.scope = targetModule === "common" ? "common" : "module";
        resource.number = number;
        resource.fileName = formatManifestResourceFileName(
          manifest,
          targetKind,
          number,
          targetModule,
          targetSubmodule
        );
        return resource;
      }
      function reconcileResourceBindings(manifest, activeLayerIdsInOrder) {
        const registry = ensureRegistry(manifest);
        const orderedLayerIds = Array.from(new Set((activeLayerIdsInOrder || []).map((layerId) => String(layerId == null ? "" : layerId).trim()).filter(Boolean)));
        const activeLayerIds = new Set(orderedLayerIds);
        const removedLayerBindings = [];
        orderedLayerIds.forEach((layerId) => {
          const node = manifest.nodes && manifest.nodes[layerId];
          const referencedResourceId = node && (node.image && node.image.resourceId || node.rawImage && node.rawImage.resourceId);
          const boundResourceId = registry.layerBindings[layerId];
          if (boundResourceId && boundResourceId !== referencedResourceId) {
            delete registry.layerBindings[layerId];
            removedLayerBindings.push(layerId);
          }
          const referencedResource = referencedResourceId && registry.resources[referencedResourceId];
          if (referencedResource && referencedResource.status === "active") {
            registry.layerBindings[layerId] = referencedResourceId;
          }
        });
        Object.keys(registry.layerBindings).forEach((layerId) => {
          const resourceId = registry.layerBindings[layerId];
          const resource = registry.resources[resourceId];
          if (!activeLayerIds.has(String(layerId)) || !resource || resource.status !== "active") {
            delete registry.layerBindings[layerId];
            if (!removedLayerBindings.includes(String(layerId))) {
              removedLayerBindings.push(String(layerId));
            }
          }
        });
        const bindingsByResource = /* @__PURE__ */ new Map();
        orderedLayerIds.forEach((layerId) => {
          const resourceId = registry.layerBindings[layerId];
          if (!resourceId) return;
          if (!bindingsByResource.has(resourceId)) bindingsByResource.set(resourceId, []);
          bindingsByResource.get(resourceId).push(layerId);
        });
        const retiredResourceIds = [];
        const reassignedResourceSources = [];
        Object.keys(registry.resources).forEach((resourceId) => {
          const resource = registry.resources[resourceId];
          if (!resource || resource.status !== "active") return;
          const survivingLayerIds = bindingsByResource.get(resourceId) || [];
          if (survivingLayerIds.length === 0) {
            resource.status = "retired";
            retiredResourceIds.push(resourceId);
            return;
          }
          if (!survivingLayerIds.includes(String(resource.sourceLayerId))) {
            const previousSourceLayerId = String(resource.sourceLayerId || "");
            resource.sourceLayerId = survivingLayerIds[0];
            reassignedResourceSources.push({
              resourceId,
              previousSourceLayerId,
              sourceLayerId: resource.sourceLayerId
            });
          }
        });
        return {
          removedLayerBindings,
          retiredResourceIds,
          reassignedResourceSources
        };
      }
      function migrateDocumentSubmodule(manifest, input) {
        const registry = ensureRegistry(manifest);
        const targetSubmodule = normalizeSubmodule(input && input.submodule);
        if (manifest.resourceNaming === "source") {
          manifest.document.submodule = targetSubmodule;
          manifest.manifestVersion = "1.1.0";
          return { document: manifest.document, migratedResources: [] };
        }
        const previousSubmodule = documentSubmodule(manifest);
        if (previousSubmodule === targetSubmodule) {
          return { document: manifest.document, migratedResources: [] };
        }
        const ownerModule = normalizeModule(manifest.document.module);
        const externalActive = Object.values(registry.resources).filter((resource) => resource && resource.status === "active" && (normalizeModule(resource.module) !== ownerModule || resource.scope !== "module"));
        if (externalActive.length > 0) {
          fail(
            "PSD2UI_EXTERNAL_RESOURCE_SUBMODULE_REQUIRED",
            "文档存在 ".concat(externalActive.length, " 个不属于 '").concat(ownerModule, "' 本地 module scope 的活动资源；本次 document submodule 迁移已阻断。")
          );
        }
        const activeByKindAndNumber = /* @__PURE__ */ new Set();
        Object.values(registry.resources).forEach((resource) => {
          if (!resource || resource.status !== "active" || normalizeModule(resource.module) !== ownerModule) return;
          const key = "".concat(resource.kind, "|").concat(resource.number);
          if (activeByKindAndNumber.has(key)) {
            fail(
              "PSD2UI_SUBMODULE_NUMBER_COLLISION",
              "资源迁移到 submodule '".concat(targetSubmodule, "' 时发现重复编号 ").concat(resource.kind, "/").concat(resource.number, "；请先人工迁移冲突资源。")
            );
          }
          activeByKindAndNumber.add(key);
        });
        const migratedResources = [];
        Object.values(registry.resources).forEach((resource) => {
          if (!resource || resource.status !== "active" || normalizeModule(resource.module) !== ownerModule || !resource.fileName) return;
          resource.history = resource.history || [];
          resource.history.push(__spreadProps(__spreadValues({
            module: resource.module
          }, resource.submodule ? { submodule: resource.submodule } : {}), {
            kind: resource.kind,
            number: resource.number,
            fileName: resource.fileName,
            reason: String(input && input.reason || "document-submodule-migration")
          }));
          resource.submodule = targetSubmodule;
          resource.fileName = formatFileName(ownerModule, resource.kind, resource.number, targetSubmodule);
          migratedResources.push(resource.id);
        });
        [ResourceKinds.SPRITE, ResourceKinds.TEXTURE].forEach((kind) => {
          const numbers = Object.values(registry.resources).filter((resource) => resource && normalizeModule(resource.module) === ownerModule && resource.kind === kind && Number.isInteger(resource.number)).map((resource) => resource.number);
          if (numbers.length > 0) {
            const legacyNext = Number.isInteger(registry.counters[counterKey(ownerModule, kind)]) ? registry.counters[counterKey(ownerModule, kind)] : 1;
            registry.counters[counterKey(ownerModule, kind, targetSubmodule)] = Math.max(
              legacyNext,
              Math.max(...numbers) + 1
            );
          }
        });
        manifest.document.submodule = targetSubmodule;
        manifest.manifestVersion = "1.1.0";
        return { document: manifest.document, migratedResources };
      }
      module.exports = {
        ResourceKinds,
        normalizeLayerId,
        normalizeModule,
        normalizeSubmodule,
        normalizeKind,
        ensureRegistry,
        formatFileName,
        formatManifestResourceFileName,
        getResourceByLayer,
        allocateResource,
        reuseResource,
        retireResource,
        reconcileResourceBindings,
        migrateResource,
        migrateDocumentSubmodule
      };
    }
  });

  // Plus-ins/PSD2UI/generated/core/validation.js
  var require_validation = __commonJS({
    "Plus-ins/PSD2UI/generated/core/validation.js"(exports, module) {
      "use strict";
      var { PRESET_VERSION, ENABLED, DISABLED } = require_defaults();
      var {
        ensureRegistry,
        normalizeModule,
        normalizeSubmodule,
        formatManifestResourceFileName
      } = require_resourceRegistry();
      var { isEnglishNodeName, parseResourceLayerName } = require_naming();
      var { validateStructureLayout } = require_structure();
      var ToggleValues = /* @__PURE__ */ new Set([ENABLED, DISABLED]);
      var SemanticValues = /* @__PURE__ */ new Set([
        "view",
        "group",
        "image",
        "raw-image",
        "text",
        "button",
        "input-field",
        "toggle",
        "list",
        "grid",
        "red-point",
        "toggle-page-group",
        "list-page-group",
        "ignore"
      ]);
      function issue(code, message, path) {
        return { code, message, path: path || "" };
      }
      function validateColor(value, path, issues) {
        if (!value || ["r", "g", "b", "a"].some((key) => typeof value[key] !== "number")) {
          issues.push(issue("PSD2UI_COLOR_REQUIRED", "颜色必须显式包含 r/g/b/a 数值。", path));
          return;
        }
        ["r", "g", "b", "a"].forEach((key) => {
          if (value[key] < 0 || value[key] > 1) {
            issues.push(issue("PSD2UI_COLOR_RANGE", "颜色分量 ".concat(key, " 必须位于 0 到 1。"), "".concat(path, ".").concat(key)));
          }
        });
      }
      function validateToggle(value, path, issues) {
        if (!ToggleValues.has(value)) {
          issues.push(issue("PSD2UI_TOGGLE_REQUIRED", "开关值必须显式填写为 'enabled' 或 'disabled'。", path));
        }
      }
      function validateSliceBorder(value, path, issues) {
        if (value == null) return;
        if (typeof value !== "object") {
          issues.push(issue("PSD2UI_SLICE_BORDER_INVALID", "九宫参数必须是对象或 null。", path));
          return;
        }
        ["left", "top", "right", "bottom"].forEach((key) => {
          if (!Number.isInteger(value[key]) || value[key] < 0) {
            issues.push(issue("PSD2UI_SLICE_BORDER_INVALID", "".concat(key, " 必须是大于或等于 0 的整数。"), "".concat(path, ".").concat(key)));
          }
        });
      }
      function validateStructure(value, path, issues) {
        if (value == null) return;
        if (value.version !== 1 || !Array.isArray(value.roles)) {
          issues.push(issue("PSD2UI_STRUCTURE_INVALID", "结构必须使用版本 1 并包含 roles 数组。", path));
          return;
        }
        value.roles.forEach((role, index) => {
          if (!role || !String(role.name || "").trim() || !String(role.layerId || "").trim()) {
            issues.push(issue("PSD2UI_STRUCTURE_ROLE_INVALID", "角色必须包含 name 和 layerId。", "".concat(path, ".roles[").concat(index, "]")));
          }
        });
        if (value.previewLayerIds != null && !Array.isArray(value.previewLayerIds)) {
          issues.push(issue("PSD2UI_STRUCTURE_PREVIEW_INVALID", "previewLayerIds 必须是数组。", "".concat(path, ".previewLayerIds")));
        }
        if (value.layoutSource != null && !["explicit", "inferred"].includes(value.layoutSource)) {
          issues.push(issue("PSD2UI_LAYOUT_SOURCE_INVALID", "layoutSource 必须为 explicit 或 inferred。", "".concat(path, ".layoutSource")));
        }
      }
      function validateGradient(value, path, issues) {
        if (!value || typeof value.isVertical !== "boolean" || !Array.isArray(value.colorKeys) || value.colorKeys.length < 2 || !Array.isArray(value.alphaKeys) || value.alphaKeys.length < 2) {
          issues.push(issue("PSD2UI_TEXT_GRADIENT_INVALID", "文本渐变必须包含方向以及至少两个颜色键和 Alpha 键。", path));
          return;
        }
        value.colorKeys.forEach((key, index) => {
          if (!key || typeof key.time !== "number" || key.time < 0 || key.time > 1) {
            issues.push(issue("PSD2UI_TEXT_GRADIENT_KEY_INVALID", "渐变颜色键 time 必须位于 0 到 1。", "".concat(path, ".colorKeys[").concat(index, "]")));
            return;
          }
          validateColor(key.color, "".concat(path, ".colorKeys[").concat(index, "].color"), issues);
        });
        value.alphaKeys.forEach((key, index) => {
          if (!key || typeof key.time !== "number" || key.time < 0 || key.time > 1 || typeof key.alpha !== "number" || key.alpha < 0 || key.alpha > 1) {
            issues.push(issue("PSD2UI_TEXT_GRADIENT_ALPHA_INVALID", "渐变 Alpha 键的 time/alpha 必须位于 0 到 1。", "".concat(path, ".alphaKeys[").concat(index, "]")));
          }
        });
      }
      function validateMeshEffect(value, path, issues) {
        if (!value) return;
        validateColor(value.color, "".concat(path, ".color"), issues);
        if (typeof value.distanceX !== "number" || typeof value.distanceY !== "number") {
          issues.push(issue("PSD2UI_TEXT_MESH_EFFECT_DISTANCE_INVALID", "描边或阴影距离必须包含 distanceX/distanceY 数值。", path));
        }
      }
      function validateTextEffects(value, path, issues) {
        if (value == null) return;
        if (typeof value !== "object") {
          issues.push(issue("PSD2UI_TEXT_EFFECTS_INVALID", "文本效果必须是对象或 null。", path));
          return;
        }
        if (value.gradient) validateGradient(value.gradient, "".concat(path, ".gradient"), issues);
        validateMeshEffect(value.outline, "".concat(path, ".outline"), issues);
        validateMeshEffect(value.shadow, "".concat(path, ".shadow"), issues);
      }
      function validateImage(image, path, registry, issues) {
        if (!["simple", "sliced", "tiled", "filled"].includes(image.imageType)) {
          issues.push(issue("PSD2UI_IMAGE_TYPE_INVALID", "imageType 必须显式填写为 simple/sliced/tiled/filled。", "".concat(path, ".imageType")));
        }
        validateSliceBorder(image.sliceBorder, "".concat(path, ".sliceBorder"), issues);
        if (image.imageType === "sliced" && !image.sliceBorder) {
          issues.push(issue("PSD2UI_SLICE_BORDER_REQUIRED", "sliced 图片必须填写左、上、右、下九宫参数。", "".concat(path, ".sliceBorder")));
        }
        validateToggle(image.preserveAspect, "".concat(path, ".preserveAspect"), issues);
        validateToggle(image.raycast, "".concat(path, ".raycast"), issues);
        validateColor(image.color, "".concat(path, ".color"), issues);
        const resource = registry.resources[image.resourceId];
        if (!resource || resource.status !== "active") {
          issues.push(issue("PSD2UI_IMAGE_RESOURCE_REQUIRED", "图片视觉必须绑定一个有效资源。", "".concat(path, ".resourceId")));
        } else if (resource.kind !== "sprite") {
          issues.push(issue("PSD2UI_IMAGE_RESOURCE_KIND", "图片视觉只能绑定 sprite 资源。", "".concat(path, ".resourceId")));
        }
      }
      function validateNode(node, path, registry, issues, sourceNaming) {
        if (!node || typeof node !== "object") {
          issues.push(issue("PSD2UI_NODE_REQUIRED", "节点配置不存在。", path));
          return;
        }
        if (!SemanticValues.has(node.semantic)) {
          issues.push(issue("PSD2UI_SEMANTIC_UNSUPPORTED", "节点语义 '".concat(node.semantic || "", "' 未注册。"), "".concat(path, ".semantic")));
        }
        if (node.presetVersion !== PRESET_VERSION) {
          issues.push(issue("PSD2UI_PRESET_VERSION", "节点必须由当前组件预设完整初始化。", "".concat(path, ".presetVersion")));
        }
        if (sourceNaming ? !String(node.name || "").trim() : !isEnglishNodeName(node.name)) {
          issues.push(issue(
            sourceNaming ? "PSD2UI_NODE_NAME_REQUIRED" : "PSD2UI_NODE_NAME_ENGLISH_REQUIRED",
            sourceNaming ? "导出节点名不能为空。" : "导出节点名必须以英文字母开头，并且只能包含英文字母、数字和下划线。",
            "".concat(path, ".name")
          ));
        }
        if (node.authoringSource != null && !["default", "explicit", "structured"].includes(node.authoringSource)) {
          issues.push(issue("PSD2UI_AUTHORING_SOURCE_INVALID", "authoringSource 必须是 default/explicit/structured。", "".concat(path, ".authoringSource")));
        }
        if (node.exportMode != null && !["runtime", "preview-only"].includes(node.exportMode)) {
          issues.push(issue("PSD2UI_EXPORT_MODE_INVALID", "exportMode 必须是 runtime 或 preview-only。", "".concat(path, ".exportMode")));
        }
        validateStructure(node.structure, "".concat(path, ".structure"), issues);
        if (node.structure && node.structure.layout != null) {
          try {
            validateStructureLayout(node.semantic, node.structure.layout);
          } catch (error) {
            issues.push(issue(error.code, error.message, "".concat(path, ".structure.layout")));
          }
        }
        validateToggle(node.visible, "".concat(path, ".visible"), issues);
        if (typeof node.opacity !== "number" || node.opacity < 0 || node.opacity > 1) {
          issues.push(issue("PSD2UI_OPACITY_RANGE", "opacity 必须显式填写为 0 到 1。", "".concat(path, ".opacity")));
        }
        if (typeof node.rotationClockwiseDegrees !== "number") {
          issues.push(issue("PSD2UI_ROTATION_REQUIRED", "rotationClockwiseDegrees 必须显式填写。", "".concat(path, ".rotationClockwiseDegrees")));
        }
        if (node.semantic === "image") {
          if (!node.image) {
            issues.push(issue("PSD2UI_IMAGE_PRESET_REQUIRED", "image 节点缺少完整图片预设。", "".concat(path, ".image")));
            return;
          }
          validateImage(node.image, "".concat(path, ".image"), registry, issues);
        } else if (node.image) {
          validateImage(node.image, "".concat(path, ".image"), registry, issues);
        }
        if (node.semantic === "raw-image") {
          if (!node.rawImage) {
            issues.push(issue("PSD2UI_RAW_IMAGE_PRESET_REQUIRED", "raw-image 节点缺少完整原始图片预设。", "".concat(path, ".rawImage")));
            return;
          }
          const uvRect = node.rawImage.uvRect;
          if (!uvRect || ["x", "y", "width", "height"].some((key) => typeof uvRect[key] !== "number")) {
            issues.push(issue("PSD2UI_RAW_IMAGE_UV_RECT_REQUIRED", "uvRect 必须显式包含 x/y/width/height 数值。", "".concat(path, ".rawImage.uvRect")));
          } else if (uvRect.width < 0 || uvRect.height < 0) {
            issues.push(issue("PSD2UI_RAW_IMAGE_UV_RECT_INVALID", "uvRect 的 width/height 不能为负数。", "".concat(path, ".rawImage.uvRect")));
          }
          validateToggle(node.rawImage.raycast, "".concat(path, ".rawImage.raycast"), issues);
          validateColor(node.rawImage.color, "".concat(path, ".rawImage.color"), issues);
          const resource = registry.resources[node.rawImage.resourceId];
          if (!resource || resource.status !== "active") {
            issues.push(issue("PSD2UI_RAW_IMAGE_RESOURCE_REQUIRED", "raw-image 节点必须绑定一个有效资源。", "".concat(path, ".rawImage.resourceId")));
          } else if (resource.kind !== "texture") {
            issues.push(issue("PSD2UI_RAW_IMAGE_RESOURCE_KIND", "raw-image 节点只能绑定 texture 资源。", "".concat(path, ".rawImage.resourceId")));
          }
        }
        if (node.semantic === "text") {
          if (!node.text) {
            issues.push(issue("PSD2UI_TEXT_PRESET_REQUIRED", "text 节点缺少完整文本预设。", "".concat(path, ".text")));
            return;
          }
          if (typeof node.text.value !== "string") {
            issues.push(issue("PSD2UI_TEXT_VALUE_REQUIRED", "文本内容必须显式填写。", "".concat(path, ".text.value")));
          }
          if (typeof node.text.fontKey !== "string" || !node.text.fontKey.trim()) {
            issues.push(issue("PSD2UI_FONT_KEY_REQUIRED", "文本必须提供 fontKey；未配置时使用 default。", "".concat(path, ".text.fontKey")));
          }
          validateTextEffects(node.text.effects, "".concat(path, ".text.effects"), issues);
          if (node.text.lineAdvance != null && (!Number.isFinite(node.text.lineAdvance) || node.text.lineAdvance <= 0)) {
            issues.push(issue("PSD2UI_LINE_ADVANCE_INVALID", "lineAdvance 必须是正的像素行距。", "".concat(path, ".text.lineAdvance")));
          }
          if (node.text.photoshop != null) {
            const ps = node.text.photoshop;
            let valid = ps.version === 1 && typeof ps.descriptorJson === "string";
            try {
              const raw = JSON.parse(ps.descriptorJson);
              valid = valid && raw != null && typeof raw === "object" && !Array.isArray(raw) && raw.version === 1;
            } catch (error) {
              valid = false;
            }
            if (!valid) issues.push(issue("PSD2UI_PHOTOSHOP_TEXT_INVALID", "photoshop 必须包含版本 1 的原始描述符 JSON。", "".concat(path, ".text.photoshop")));
          }
          if (Object.prototype.hasOwnProperty.call(node.text, "layoutMode") && !["point", "paragraph"].includes(node.text.layoutMode)) {
            issues.push(issue(
              "PSD2UI_TEXT_LAYOUT_MODE_INVALID",
              "layoutMode 只能为 point 或 paragraph；无法确定文本类型时应省略。",
              "".concat(path, ".text.layoutMode")
            ));
          }
          if (!Number.isInteger(node.text.fontSize) || node.text.fontSize < 1) {
            issues.push(issue("PSD2UI_FONT_SIZE_INVALID", "fontSize 必须是大于 0 的整数。", "".concat(path, ".text.fontSize")));
          }
          if (!["upper-left", "upper-center", "upper-right", "middle-left", "middle-center", "middle-right", "lower-left", "lower-center", "lower-right"].includes(node.text.alignment)) {
            issues.push(issue("PSD2UI_TEXT_ALIGNMENT_INVALID", "文本对齐参数无效。", "".concat(path, ".text.alignment")));
          }
          validateToggle(node.text.richText, "".concat(path, ".text.richText"), issues);
          validateToggle(node.text.raycast, "".concat(path, ".text.raycast"), issues);
          validateColor(node.text.color, "".concat(path, ".text.color"), issues);
          if (typeof node.text.lineSpacing !== "number" || node.text.lineSpacing <= 0) {
            issues.push(issue("PSD2UI_LINE_SPACING_INVALID", "lineSpacing 必须大于 0。", "".concat(path, ".text.lineSpacing")));
          }
        }
        if (node.semantic === "button") {
          if (!node.button) {
            issues.push(issue("PSD2UI_BUTTON_PRESET_REQUIRED", "button 节点缺少完整按钮预设。", "".concat(path, ".button")));
            return;
          }
          validateToggle(node.button.interactable, "".concat(path, ".button.interactable"), issues);
          if (node.button.transition !== "color-tint") {
            issues.push(issue("PSD2UI_BUTTON_TRANSITION_INVALID", "最小切片只支持显式 transition='color-tint'。", "".concat(path, ".button.transition")));
          }
        }
      }
      function validateManifest(manifest) {
        const issues = [];
        if (!manifest || typeof manifest !== "object") {
          return [issue("PSD2UI_MANIFEST_REQUIRED", "PSD2UI Manifest 不存在。")];
        }
        if (manifest.manifestVersion !== "1.0.0" && manifest.manifestVersion !== "1.1.0") {
          issues.push(issue(
            "PSD2UI_MANIFEST_VERSION",
            "manifestVersion 只支持 '1.0.0' 或 '1.1.0'。",
            "manifestVersion"
          ));
        }
        if (!manifest.document) {
          issues.push(issue("PSD2UI_DOCUMENT_REQUIRED", "文档参数不存在。", "document"));
          return issues;
        }
        try {
          normalizeModule(manifest.document.module);
          if (manifest.document.module === "common") {
            issues.push(issue(
              "PSD2UI_DOCUMENT_MODULE_COMMON",
              "PSD 文档必须绑定业务 module；Common 只用于具体资源。",
              "document.module"
            ));
          }
        } catch (error) {
          issues.push(issue(error.code || "PSD2UI_MODULE_INVALID", error.message, "document.module"));
        }
        if (!manifest.document.id || !manifest.document.name || !manifest.document.rootLayerId) {
          issues.push(issue("PSD2UI_DOCUMENT_FIELDS_REQUIRED", "document.id/name/rootLayerId 都必须显式填写。", "document"));
        }
        const sourceNaming = manifest.resourceNaming === "source";
        if (manifest.manifestVersion === "1.1.0") {
          try {
            normalizeSubmodule(manifest.document.submodule);
          } catch (error) {
            issues.push(issue(error.code || "PSD2UI_SUBMODULE_INVALID", error.message, "document.submodule"));
          }
        } else if (manifest.document.submodule != null) {
          issues.push(issue(
            "PSD2UI_SUBMODULE_VERSION_REQUIRED",
            "document.submodule 只能用于 manifestVersion='1.1.0'。",
            "document.submodule"
          ));
        }
        if (sourceNaming ? !String(manifest.document.name || "").trim() : !isEnglishNodeName(manifest.document.name)) {
          issues.push(issue(
            sourceNaming ? "PSD2UI_DOCUMENT_NAME_REQUIRED" : "PSD2UI_DOCUMENT_NAME_ENGLISH_REQUIRED",
            sourceNaming ? "界面名称不能为空。" : "界面名称必须以英文字母开头，并且只能包含英文字母、数字和下划线。",
            "document.name"
          ));
        }
        if (!(manifest.document.width > 0) || !(manifest.document.height > 0)) {
          issues.push(issue("PSD2UI_DESIGN_SIZE_INVALID", "文档 width/height 必须大于 0。", "document"));
        }
        const registry = ensureRegistry(manifest);
        const activeFileNames = /* @__PURE__ */ new Map();
        Object.keys(registry.resources).forEach((resourceId) => {
          const resource = registry.resources[resourceId];
          if (!resource || resource.status !== "active") return;
          let expected;
          try {
            if (sourceNaming) {
              const parsed = parseResourceLayerName(String(resource.fileName || "").replace(/\.png$/, ""), resource.sourceLayerId);
              expected = parsed.fileName;
              if (resource.module !== parsed.group || resource.scope !== "module" || !["sprite", "texture"].includes(resource.kind) || !Number.isInteger(resource.number) || resource.number < 1) {
                issues.push(issue(
                  "PSD2UI_SOURCE_RESOURCE_INVALID",
                  "资源须保留图片基础名首段分组、module scope、明确图片类型和正序身份编号。",
                  "resourceRegistry.resources.".concat(resourceId)
                ));
              }
            } else expected = formatManifestResourceFileName(
              manifest,
              resource.kind,
              resource.number,
              resource.module,
              resource.submodule
            );
          } catch (error) {
            issues.push(issue(
              error.code || "PSD2UI_RESOURCE_FILENAME_INVALID",
              error.message,
              "resourceRegistry.resources.".concat(resourceId, ".fileName")
            ));
            return;
          }
          if (resource.fileName !== expected) {
            issues.push(issue(
              "PSD2UI_RESOURCE_FILENAME_MISMATCH",
              "资源文件名 '".concat(resource.fileName || "", "' 与当前 document module/submodule、kind、number 不一致；预期 '").concat(expected, "'。"),
              "resourceRegistry.resources.".concat(resourceId, ".fileName")
            ));
          }
          if (resource.fileName) {
            const fileKey = resource.fileName.toLowerCase();
            const previousResourceId = activeFileNames.get(fileKey);
            if (previousResourceId) {
              issues.push(issue(
                "PSD2UI_RESOURCE_FILENAME_DUPLICATE",
                "活动资源 '".concat(previousResourceId, "' 与 '").concat(resourceId, "' 使用了同一文件名 '").concat(resource.fileName, "'。"),
                "resourceRegistry.resources.".concat(resourceId, ".fileName")
              ));
            } else {
              activeFileNames.set(fileKey, resourceId);
            }
          }
          if (!sourceNaming && manifest.manifestVersion === "1.1.0" && resource.module === manifest.document.module && resource.submodule !== manifest.document.submodule) {
            issues.push(issue(
              "PSD2UI_RESOURCE_SUBMODULE_MISMATCH",
              "本地资源 submodule '".concat(resource.submodule || "", "' 与 document.submodule '").concat(manifest.document.submodule, "' 不一致。"),
              "resourceRegistry.resources.".concat(resourceId, ".submodule")
            ));
          }
        });
        const nodes = manifest.nodes || {};
        Object.keys(nodes).forEach((layerId) => validateNode(nodes[layerId], "nodes.".concat(layerId), registry, issues, sourceNaming));
        const root = nodes[String(manifest.document.rootLayerId)];
        if (!root || root.semantic !== "view") {
          issues.push(issue("PSD2UI_ROOT_VIEW_REQUIRED", "文档根图层必须使用完整 view 预设。", "document.rootLayerId"));
        }
        return issues;
      }
      function assertManifestValid(manifest) {
        const issues = validateManifest(manifest);
        if (issues.length > 0) {
          const error = new Error("PSD2UI 导出预检失败，共 ".concat(issues.length, " 项。"));
          error.name = "Psd2UiValidationError";
          error.code = "PSD2UI_PREFLIGHT_FAILED";
          error.issues = issues;
          throw error;
        }
        return manifest;
      }
      module.exports = { validateManifest, assertManifestValid };
    }
  });

  // Plus-ins/PSD2UI/generated/core/snapshot.js
  var require_snapshot = __commonJS({
    "Plus-ins/PSD2UI/generated/core/snapshot.js"(exports, module) {
      "use strict";
      var { createPreset, ENABLED, DISABLED } = require_defaults();
      var { createId } = require_ids();
      var { fail } = require_errors();
      var {
        allocateResource,
        ensureRegistry,
        reconcileResourceBindings
      } = require_resourceRegistry();
      var {
        isGroupLayer,
        normalizeLayerKind,
        requiresStructure,
        planCollectionLayout,
        validateStructureLayout,
        validateTemplateSize,
        isWithinComponent,
        StructureRoleContracts,
        structureRoleContract,
        validateVisualStates
      } = require_structure();
      var { applyManifestNodeNames } = require_naming();
      var ImplicitImageSemantics = /* @__PURE__ */ new Set([
        "button",
        "input-field",
        "toggle",
        "list",
        "grid",
        "red-point",
        "toggle-page-group",
        "list-page-group"
      ]);
      var StructureRecoveryHint = "请在当前组件的设置中核对角色、模板和布局；普通嵌套组无需移回直属层。";
      function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
      }
      function number(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
      }
      function boundsSize(layer) {
        const bounds = layer && layer.bounds || {};
        return {
          width: Math.max(0, number(bounds.right, 0) - number(bounds.left, 0)),
          height: Math.max(0, number(bounds.bottom, 0) - number(bounds.top, 0))
        };
      }
      function inferSemantic(layer, isRoot, threshold) {
        if (isRoot) return "view";
        const kind = normalizeLayerKind(layer);
        if (kind === "group") return "group";
        if (kind === "text") return "text";
        const size = boundsSize(layer);
        return size.width > threshold || size.height > threshold ? "raw-image" : "image";
      }
      var AutomaticImagePolicy = Object.freeze({ textureMinArea: 512 * 512, spriteMaxSide: 2040 });
      function inferSourceSemantic(layer, isRoot) {
        const semantic = inferSemantic(layer, isRoot, Infinity);
        if (semantic !== "image") return semantic;
        const size = boundsSize(layer);
        return size.width * size.height >= AutomaticImagePolicy.textureMinArea || Math.max(size.width, size.height) > AutomaticImagePolicy.spriteMaxSide ? "raw-image" : "image";
      }
      function applyAutomaticImagePolicy(manifest, root) {
        if (manifest.resourceNaming !== "source") return;
        const nodes = manifest.nodes || {};
        const spriteRequired = /* @__PURE__ */ new Set();
        Object.values(nodes).forEach((owner) => {
          (owner.structure && owner.structure.roles || []).forEach((role) => {
            const contract = structureRoleContract(owner.semantic, role.name);
            if (contract && contract.semantics.includes("image") && !contract.semantics.includes("raw-image")) {
              spriteRequired.add(String(role.layerId));
            }
          });
        });
        function visit(layer) {
          if (!layer) return;
          const id = String(layer.layerId == null ? layer.id : layer.layerId);
          const node = nodes[id];
          if (node && node.authoringSource === "default" && normalizeLayerKind(layer) === "image" && ["image", "raw-image"].includes(node.semantic) && !node.structure && !node.visualStates) {
            const oldKey = node.semantic === "image" ? "image" : "rawImage";
            const previous = node[oldKey] || {};
            const specificSettings = oldKey === "image" ? previous.imageType && previous.imageType !== "simple" || previous.sliceBorder || previous.preserveAspect === ENABLED : previous.uvRect && Object.entries({ x: 0, y: 0, width: 1, height: 1 }).some(([key, value]) => previous.uvRect[key] !== value);
            const semantic = spriteRequired.has(id) ? "image" : inferSourceSemantic(layer, false);
            if (!specificSettings && semantic !== node.semantic) {
              const key = semantic === "image" ? "image" : "rawImage";
              node[key] = createPreset(semantic)[key];
              for (const field of ["resourceId", "raycast", "color"]) {
                if (Object.prototype.hasOwnProperty.call(previous, field)) node[key][field] = previous[field];
              }
              delete node[oldKey];
              node.semantic = semantic;
            }
          }
          (layer.children || []).forEach(visit);
        }
        visit(root);
      }
      function projectAutomaticImageSemantics(currentManifest, snapshot) {
        const manifest = clone(currentManifest);
        if (manifest && snapshot) applyAutomaticImagePolicy(manifest, snapshot.root);
        return manifest;
      }
      function collectUnconfiguredEmptyGroupIds(root, manifest) {
        const emptyIds = /* @__PURE__ */ new Set();
        const nodes = manifest && manifest.nodes || {};
        const rootId = String(manifest && manifest.document && manifest.document.rootLayerId || "");
        const referencedIds = /* @__PURE__ */ new Set();
        Object.values(nodes).forEach((node) => {
          (node.structure && node.structure.roles || []).forEach((role) => referencedIds.add(String(role.layerId)));
          (node.visualStates && node.visualStates.states || []).forEach((state) => referencedIds.add(String(state.layerId)));
        });
        function visit(layer) {
          if (!layer) return;
          const children = layer.children || [];
          children.forEach(visit);
          const id = String(layer.layerId == null ? layer.id : layer.layerId);
          const node = nodes[id];
          if (id !== rootId && !referencedIds.has(id) && isGroupLayer(layer) && (!node || node.authoringSource === "default" && !node.structure && !node.visualStates && !node.viewport) && children.every((child) => emptyIds.has(String(child.layerId == null ? child.id : child.layerId)))) {
            emptyIds.add(id);
          }
        }
        visit(root);
        return emptyIds;
      }
      function normalizeColor(value) {
        if (!value) return null;
        const result = {};
        for (const key of ["r", "g", "b", "a"]) {
          if (!Number.isFinite(Number(value[key]))) return null;
          result[key] = Math.max(0, Math.min(1, Number(value[key])));
        }
        return result;
      }
      function applyPhotoshopOwnedValues(node, layer) {
        if (typeof layer.visible === "boolean") node.visible = layer.visible ? ENABLED : DISABLED;
        if (Number.isFinite(Number(layer.opacity))) node.opacity = Math.max(0, Math.min(1, Number(layer.opacity)));
        if (Number.isFinite(Number(layer.rotationClockwiseDegrees))) {
          node.rotationClockwiseDegrees = Number(layer.rotationClockwiseDegrees);
        }
        if (node.semantic !== "text" || !node.text) return;
        if (!layer.text) {
          delete node.text.layoutMode;
          return;
        }
        if (typeof layer.text.value === "string") node.text.value = layer.text.value;
        if (Number.isFinite(Number(layer.text.fontSize)) && Number(layer.text.fontSize) > 0) {
          node.text.fontSize = Math.max(1, Math.round(Number(layer.text.fontSize)));
        }
        if (typeof layer.text.alignment === "string" && layer.text.alignment) {
          node.text.alignment = layer.text.alignment;
        }
        if (["point", "paragraph"].includes(layer.text.layoutMode)) {
          node.text.layoutMode = layer.text.layoutMode;
        } else {
          delete node.text.layoutMode;
        }
        if (Number.isFinite(Number(layer.text.lineSpacing)) && Number(layer.text.lineSpacing) > 0) {
          node.text.lineSpacing = Number(layer.text.lineSpacing);
        }
        if (Number.isFinite(layer.text.lineAdvance) && layer.text.lineAdvance > 0) node.text.lineAdvance = layer.text.lineAdvance;
        else delete node.text.lineAdvance;
        if (layer.text.photoshop) node.text.photoshop = clone(layer.text.photoshop);
        else delete node.text.photoshop;
        const color = normalizeColor(layer.text.color);
        if (color) node.text.color = color;
        node.text.effects = layer.text.effects ? clone(layer.text.effects) : null;
      }
      function ensureNodeShape(node) {
        if (!node.authoringSource) node.authoringSource = "explicit";
        if (!node.exportMode) node.exportMode = "runtime";
        if (!Object.prototype.hasOwnProperty.call(node, "structure")) node.structure = null;
        if (node.semantic === "image" && node.image && !Object.prototype.hasOwnProperty.call(node.image, "sliceBorder")) {
          node.image.sliceBorder = null;
        }
        if (node.semantic === "text" && node.text && !node.text.fontKey) node.text.fontKey = "default";
        return node;
      }
      function collectSnapshotTopology(root) {
        const parentById = {};
        const layersById = {};
        const layerIdsInOrder = [];
        function visit(layer, parentLayerId) {
          if (!layer) return;
          const layerId = String(layer.layerId == null ? "" : layer.layerId);
          if (!layerId) fail("PSD2UI_SNAPSHOT_LAYER_ID_REQUIRED", "Photoshop 快照中存在缺少 layerId 的图层。");
          parentById[layerId] = parentLayerId || "";
          layersById[layerId] = layer;
          layerIdsInOrder.push(layerId);
          (layer.children || []).forEach((child) => visit(child, layerId));
        }
        visit(root, "");
        return { parentById, layersById, layerIdsInOrder };
      }
      function requiredStructureRoleNames(semantic, roles) {
        if (semantic === "toggle-page-group") {
          const indexes = (roles || []).map((role) => /^toggle-(0|[1-9][0-9]*)$/.exec(String(role && role.name || ""))).filter(Boolean).map((match) => Number(match[1]));
          if (indexes.length === 0) return ["toggle-0"];
          const maximum = Math.max(...indexes);
          return Array.from({ length: maximum + 1 }, (_entry, index) => "toggle-".concat(index));
        }
        const contracts = StructureRoleContracts[semantic] || {};
        return Object.keys(contracts).filter((roleName) => contracts[roleName].required);
      }
      function isDescendantLayer(layerId, ancestorLayerId, parentById) {
        let current = String(layerId || "");
        const ancestor = String(ancestorLayerId || "");
        const visited = /* @__PURE__ */ new Set();
        while (current && !visited.has(current)) {
          visited.add(current);
          current = String(parentById[current] || "");
          if (current === ancestor) return true;
        }
        return false;
      }
      function prepareManifestForExport(currentManifest, snapshot, options) {
        if (!currentManifest || !currentManifest.document) {
          fail("PSD2UI_MANIFEST_REQUIRED", "请先初始化当前 PSD 文档，再执行默认导出。");
        }
        if (!snapshot || !snapshot.root) {
          fail("PSD2UI_SNAPSHOT_REQUIRED", "默认导出需要当前 Photoshop 图层树快照。");
        }
        const manifest = clone(currentManifest);
        manifest.nodes = manifest.nodes || {};
        const registry = ensureRegistry(manifest);
        const topology = collectSnapshotTopology(snapshot.root);
        const activeLayerIds = new Set(topology.layerIdsInOrder);
        const removedLayerIds = Object.keys(manifest.nodes).filter((layerId) => !activeLayerIds.has(String(layerId)));
        removedLayerIds.forEach((layerId) => delete manifest.nodes[layerId]);
        const removedPreviewLayerIds = [];
        Object.keys(manifest.nodes).forEach((layerId) => {
          const structure = manifest.nodes[layerId] && manifest.nodes[layerId].structure;
          if (!structure || !Array.isArray(structure.previewLayerIds)) return;
          structure.previewLayerIds = structure.previewLayerIds.filter((previewLayerId) => {
            const previewId = String(previewLayerId);
            const keep = activeLayerIds.has(previewId) && isDescendantLayer(previewId, layerId, topology.parentById);
            if (!keep) removedPreviewLayerIds.push(previewId);
            return keep;
          });
        });
        const idFactory = options && options.idFactory ? options.idFactory : createId;
        const threshold = options && Number.isFinite(options.largeImageThreshold) ? options.largeImageThreshold : 512;
        const allocateResources = !options || options.allocateResources !== false;
        let defaultedCount = 0;
        let defaultSemanticCount = 0;
        function ensureVisualResourceTarget(node, layer) {
          const implicitImage = ImplicitImageSemantics.has(node.semantic) && normalizeLayerKind(layer) === "image";
          if (implicitImage && !node.image) {
            node.image = createPreset("image").image;
          }
          if (node.semantic !== "image" && node.semantic !== "raw-image" && !implicitImage) {
            return null;
          }
          const componentKey = node.semantic === "raw-image" ? "rawImage" : "image";
          const resourceKind = node.semantic === "raw-image" ? "texture" : "sprite";
          if (!node[componentKey]) {
            const replacement = createPreset(node.semantic === "raw-image" ? "raw-image" : "image");
            node[componentKey] = replacement[componentKey];
          }
          return { componentKey, resourceKind };
        }
        function visit(layer, isRoot) {
          const layerId = String(layer.layerId == null ? "" : layer.layerId);
          if (!layerId) fail("PSD2UI_SNAPSHOT_LAYER_ID_REQUIRED", "Photoshop 快照中存在缺少 layerId 的图层。");
          let node = manifest.nodes[layerId];
          if (!node) {
            const semantic = manifest.resourceNaming === "source" ? inferSourceSemantic(layer, isRoot) : inferSemantic(layer, isRoot, threshold);
            node = createPreset(semantic);
            node.id = idFactory("node");
            node.layerId = layerId;
            node.name = String(layer.name || "Layer-".concat(layerId));
            node.authoringSource = "default";
            manifest.nodes[layerId] = node;
            defaultedCount += 1;
          }
          ensureNodeShape(node);
          applyPhotoshopOwnedValues(node, layer);
          if (node.authoringSource === "default") defaultSemanticCount += 1;
          const visualTarget = ensureVisualResourceTarget(node, layer);
          if (visualTarget && !node[visualTarget.componentKey].resourceId) {
            const boundResourceId = registry.layerBindings[layerId];
            const boundResource = boundResourceId && registry.resources[boundResourceId];
            if (boundResource && boundResource.status === "active" && boundResource.kind === visualTarget.resourceKind) {
              node[visualTarget.componentKey].resourceId = boundResource.id;
            }
          }
          (layer.children || []).forEach((child) => visit(child, false));
        }
        visit(snapshot.root, true);
        applyAutomaticImagePolicy(manifest, snapshot.root);
        const resourceReconciliation = reconcileResourceBindings(
          manifest,
          topology.layerIdsInOrder
        );
        const previewLayerIdSet = /* @__PURE__ */ new Set();
        const runtimeLayerIds = /* @__PURE__ */ new Set();
        const emptyGroupIds = collectUnconfiguredEmptyGroupIds(snapshot.root, manifest);
        const sourceCandidates = manifest.resourceNaming === "source" ? /* @__PURE__ */ Object.create(null) : void 0;
        function collectRuntimeLayers(layer) {
          if (!layer) return;
          const layerId = String(layer.layerId);
          const node = manifest.nodes[layerId];
          if (!node || node.semantic === "ignore" || node.exportMode === "preview-only" || previewLayerIdSet.has(layerId) || emptyGroupIds.has(layerId)) return;
          runtimeLayerIds.add(layerId);
          (node.structure && node.structure.previewLayerIds || []).forEach((previewLayerId) => previewLayerIdSet.add(String(previewLayerId)));
          if (sourceCandidates) {
            const visualTarget = ensureVisualResourceTarget(node, layer);
            if (visualTarget) sourceCandidates[layerId] = { layerName: layer.name, kind: visualTarget.resourceKind };
          }
          (layer.children || []).forEach(collectRuntimeLayers);
        }
        collectRuntimeLayers(snapshot.root);
        if (allocateResources) {
          let allocateMissingResources = function(layer) {
            const layerId = String(layer.layerId);
            if (sourceCandidates && !runtimeLayerIds.has(layerId)) return;
            const node = manifest.nodes[layerId];
            const visualTarget = ensureVisualResourceTarget(node, layer);
            if (visualTarget && (manifest.resourceNaming === "source" || !node[visualTarget.componentKey].resourceId)) {
              const resource = allocateResource(manifest, {
                layerId,
                layerName: layer.name,
                kind: visualTarget.resourceKind,
                module: manifest.document.module
              }, { idFactory, sourceCandidates });
              node[visualTarget.componentKey].resourceId = resource.id;
            }
            (layer.children || []).forEach(allocateMissingResources);
          };
          allocateMissingResources(snapshot.root);
        }
        applyManifestNodeNames(manifest, snapshot);
        const diagnostics = [];
        if (removedLayerIds.length > 0 || resourceReconciliation.retiredResourceIds.length > 0 || resourceReconciliation.reassignedResourceSources.length > 0 || removedPreviewLayerIds.length > 0) {
          diagnostics.push({
            severity: "warning",
            code: "PSD2UI_LAYER_TREE_RECONCILED",
            nodeId: "",
            message: "已按当前 Photoshop 图层树同步配置：删除 ".concat(removedLayerIds.length, " 个失效节点，") + "停用 ".concat(resourceReconciliation.retiredResourceIds.length, " 个无引用资源，") + "重定向 ".concat(resourceReconciliation.reassignedResourceSources.length, " 个资源来源。")
          });
        }
        if (defaultSemanticCount > 0) {
          diagnostics.push({
            severity: "warning",
            code: "PSD2UI_DEFAULT_SEMANTICS_APPLIED",
            nodeId: "",
            message: "有 ".concat(defaultSemanticCount, " 个图层没有人工语义配置，已按 Photoshop 类型和尺寸使用默认投影。")
          });
        }
        Object.keys(manifest.nodes).forEach((layerId) => {
          const node = manifest.nodes[layerId];
          if (!runtimeLayerIds.has(String(layerId))) return;
          const layer = topology.layersById[String(layerId)];
          const layerKind = normalizeLayerKind(layer);
          if (node.visualStates) {
            try {
              if (!isGroupLayer(layer)) fail("PSD2UI_VISUAL_STATE_ROOT_INVALID", "视觉状态只能配置在 Photoshop 组上。");
              const settings = validateVisualStates(node.visualStates);
              settings.states.forEach((state) => {
                const target = topology.layersById[state.layerId];
                if (!target || !isGroupLayer(target) || !runtimeLayerIds.has(state.layerId) || !isWithinComponent(state.layerId, layerId, topology.parentById, manifest.nodes)) {
                  fail("PSD2UI_VISUAL_STATE_SCOPE_INVALID", "状态 '".concat(state.name, "' 必须指向当前组件内可导出的组，不能穿越其他组件。"));
                }
                if (settings.states.some((other) => other.layerId !== state.layerId && isDescendantLayer(state.layerId, other.layerId, topology.parentById))) {
                  fail("PSD2UI_VISUAL_STATE_OVERLAP", "不同状态组不能互相嵌套。");
                }
              });
            } catch (error) {
              diagnostics.push({
                severity: "error",
                code: error.code || "PSD2UI_VISUAL_STATES_INVALID",
                nodeId: node.id || "",
                message: "节点 '".concat(node.name || layerId, "'：").concat(error.message)
              });
            }
          }
          if (node.viewport) {
            const viewport = node.viewport;
            if (!["list", "grid"].includes(node.semantic) || !isGroupLayer(layer) || !Number.isFinite(viewport.width) || viewport.width <= 0 || !Number.isFinite(viewport.height) || viewport.height <= 0 || Object.keys(viewport).some((key) => !["width", "height"].includes(key))) {
              diagnostics.push({
                severity: "error",
                code: "PSD2UI_VIEWPORT_INVALID",
                nodeId: node.id || "",
                message: "可视区域必须位于列表或网格组根，并填写正的 width/height。"
              });
            } else {
              const currentBounds = Object.fromEntries(["left", "top", "right", "bottom"].map((key) => [key, number(layer.bounds && layer.bounds[key], 0)]));
              if (!node.viewportSourceBounds) node.viewportSourceBounds = currentBounds;
              else if (Object.keys(currentBounds).some((key) => Math.abs(currentBounds[key] - node.viewportSourceBounds[key]) > 0.01)) {
                diagnostics.push({
                  severity: "warning",
                  code: "PSD2UI_VIEWPORT_SOURCE_CHANGED",
                  nodeId: node.id || "",
                  message: "组件 '".concat(node.name || layerId, "' 的 PSD 范围已变化；保留明确设置的可视区域 ").concat(viewport.width, " × ").concat(viewport.height, "，请核对预览。")
                });
              }
            }
          }
          const directImageButton = node.semantic === "button" && node.image && !node.structure && layerKind === "image";
          const structuredComponent = requiresStructure(node.semantic) && !directImageButton;
          if (structuredComponent && !isGroupLayer(layer)) {
            diagnostics.push({
              severity: "error",
              code: "PSD2UI_STRUCTURE_ROOT_GROUP_REQUIRED",
              nodeId: node.id || "",
              message: "组件 '".concat(node.name || layerId, "' 的结构根必须是 Photoshop 组，当前类型为 ").concat(layerKind, "。") + "请先在 Photoshop 图层面板中建立组，再选择该组执行结构化。"
            });
            return;
          }
          if (structuredComponent && (!Array.isArray(layer.children) || layer.children.length === 0)) {
            diagnostics.push({
              severity: "error",
              code: "PSD2UI_STRUCTURE_ROOT_EMPTY",
              nodeId: node.id || "",
              message: "组件 '".concat(node.name || layerId, "' 的 Photoshop 组根没有直属子图层，不能导出为空组件节点。") + "请补齐直属子图层后，在同一组重新结构化。"
            });
            return;
          }
          if (structuredComponent) {
            const size = boundsSize(layer);
            if (size.width <= 0 || size.height <= 0) {
              diagnostics.push({
                severity: "error",
                code: "PSD2UI_STRUCTURE_ROOT_BOUNDS_INVALID",
                nodeId: node.id || "",
                message: "组件 '".concat(node.name || layerId, "' 的 Photoshop 组根必须具有正的像素宽高，") + "当前为 ".concat(size.width, " × ").concat(size.height, "；不会导出为丢失坐标或尺寸的空节点。")
              });
              return;
            }
          }
          if (structuredComponent && (!node.structure || !Array.isArray(node.structure.roles) || node.structure.roles.length === 0)) {
            diagnostics.push({
              severity: "error",
              code: "PSD2UI_STRUCTURE_INCOMPLETE",
              nodeId: node.id || "",
              message: "节点 '".concat(node.name || layerId, "' 已标记为 ").concat(node.semantic, "，但没有组件结构角色。").concat(StructureRecoveryHint)
            });
            return;
          }
          if (!node.structure || !Array.isArray(node.structure.roles)) return;
          const rolesByName = /* @__PURE__ */ new Map();
          const roleTargetIds = /* @__PURE__ */ new Set();
          node.structure.roles.forEach((role) => {
            const roleName = String(role && role.name || "");
            if (rolesByName.has(roleName)) {
              diagnostics.push({
                severity: "error",
                code: "PSD2UI_STRUCTURE_ROLE_INVALID",
                nodeId: node.id || "",
                message: "组件 '".concat(node.name || layerId, "' 的角色 '").concat(roleName || "<empty>", "' 重复。").concat(StructureRecoveryHint)
              });
            } else {
              rolesByName.set(roleName, role);
            }
            const roleId = String(role && role.layerId || "");
            if (roleTargetIds.has(roleId)) {
              diagnostics.push({
                severity: "error",
                code: "PSD2UI_STRUCTURE_ROLE_DUPLICATE",
                nodeId: node.id || "",
                message: "组件 '".concat(node.name || layerId, "' 多个角色指向同一个图层 ").concat(roleId, "。")
              });
            }
            roleTargetIds.add(roleId);
          });
          requiredStructureRoleNames(node.semantic, node.structure.roles).forEach((roleName) => {
            if (rolesByName.has(roleName)) return;
            diagnostics.push({
              severity: "error",
              code: "PSD2UI_STRUCTURE_ROLE_INVALID",
              nodeId: node.id || "",
              message: "组件 '".concat(node.name || layerId, "' 缺少必需角色 '").concat(roleName, "'。").concat(StructureRecoveryHint)
            });
          });
          node.structure.roles.forEach((role) => {
            const roleName = String(role && role.name || "");
            const contract = structureRoleContract(node.semantic, roleName);
            if (!contract) {
              diagnostics.push({
                severity: "error",
                code: "PSD2UI_STRUCTURE_ROLE_INVALID",
                nodeId: node.id || "",
                message: "组件 '".concat(node.name || layerId, "' 的语义 ").concat(node.semantic, " 不支持角色 '").concat(roleName || "<empty>", "'。").concat(StructureRecoveryHint)
              });
            }
            const roleLayerId = String(role && role.layerId || "");
            const targetIsValid = activeLayerIds.has(roleLayerId) && runtimeLayerIds.has(roleLayerId) && isDescendantLayer(roleLayerId, layerId, topology.parentById);
            if (!targetIsValid) {
              diagnostics.push({
                severity: "error",
                code: "PSD2UI_STRUCTURE_ROLE_MISSING",
                nodeId: node.id || "",
                message: "组件 '".concat(node.name || layerId, "' 的角色 '").concat(roleName, "' 指向图层 ").concat(roleLayerId || "<empty>", "，") + "但该图层已删除、移出组件组或不再参与导出。".concat(StructureRecoveryHint)
              });
              return;
            }
            if (!isWithinComponent(roleLayerId, layerId, topology.parentById, manifest.nodes)) {
              diagnostics.push({
                severity: "error",
                code: "PSD2UI_STRUCTURE_ROLE_CROSSES_COMPONENT",
                nodeId: node.id || "",
                message: "组件 '".concat(node.name || layerId, "' 的角色 '").concat(roleName, "' 指向图层 ").concat(roleLayerId, "，") + "但该引用穿越了另一个已配置组件的内部。".concat(StructureRecoveryHint)
              });
              return;
            }
            if (!contract) return;
            const targetLayer = topology.layersById[roleLayerId];
            const targetNode = manifest.nodes[roleLayerId];
            const targetKind = normalizeLayerKind(targetLayer);
            const kindMatches = contract.kinds.length === 0 || contract.kinds.includes(targetKind);
            const semanticMatches = contract.semantics.length === 0 || contract.semantics.includes(String(targetNode && targetNode.semantic || ""));
            if (kindMatches && semanticMatches) return;
            diagnostics.push({
              severity: "error",
              code: "PSD2UI_STRUCTURE_ROLE_TYPE_MISMATCH",
              nodeId: node.id || "",
              message: "组件 '".concat(node.name || layerId, "' 的角色 '").concat(roleName, "' 指向图层 ").concat(roleLayerId, "，") + "当前 Photoshop 类型为 ".concat(targetKind, "、语义为 ").concat(targetNode && targetNode.semantic || "<missing>", "，") + "已不符合原组件结构。".concat(StructureRecoveryHint)
            });
          });
          if (node.semantic === "list" || node.semantic === "grid") {
            try {
              const templateName = node.semantic === "list" ? "item-template" : "cell-template";
              const template = rolesByName.get(templateName);
              const sampleIds = [.../* @__PURE__ */ new Set([
                String(template && template.layerId || ""),
                ...(node.structure.previewLayerIds || []).map(String)
              ])];
              const templateId = String(template && template.layerId || "");
              const samples = sampleIds.map((id) => topology.layersById[id]).filter(Boolean);
              (node.structure.previewLayerIds || []).forEach((id) => {
                const sampleId = String(id);
                const sample = topology.layersById[sampleId];
                if (sampleId === templateId || !sample || !isGroupLayer(sample) || topology.parentById[sampleId] !== topology.parentById[templateId] || !isWithinComponent(sampleId, layerId, topology.parentById, manifest.nodes)) {
                  fail("PSD2UI_STRUCTURE_PREVIEW_INVALID", "预览样例必须是当前模板的同级组，不能穿越其他组件。");
                }
              });
              if (samples.length >= 2 && node.structure.layoutSource !== "explicit") {
                node.structure.layout = planCollectionLayout(node.semantic, samples);
              }
              const templateLayer = topology.layersById[String(template && template.layerId || "")];
              validateTemplateSize(node.semantic, node.structure.layout, templateLayer || {});
            } catch (error) {
              diagnostics.push({
                severity: "error",
                code: error.code || "PSD2UI_STRUCTURE_LAYOUT_INVALID",
                nodeId: node.id || "",
                message: "组件 '".concat(node.name || layerId, "'：").concat(error.message, " ").concat(StructureRecoveryHint)
              });
            }
          }
        });
        return {
          manifest,
          diagnostics,
          defaultedCount,
          defaultSemanticCount,
          reconciliation: __spreadValues({
            removedLayerIds,
            removedPreviewLayerIds
          }, resourceReconciliation)
        };
      }
      function normalizedLayerState(layer) {
        const bounds = layer.bounds || {};
        const state = {
          name: String(layer.name || ""),
          kind: normalizeLayerKind(layer),
          bounds: {
            left: number(bounds.left, 0),
            top: number(bounds.top, 0),
            right: number(bounds.right, 0),
            bottom: number(bounds.bottom, 0)
          },
          visible: layer.visible !== false,
          opacity: number(layer.opacity, 1),
          text: null,
          styleSignature: String(layer.styleSignature || "")
        };
        if (layer.text) {
          state.text = {
            value: String(layer.text.value || ""),
            fontSize: number(layer.text.fontSize, 0),
            alignment: String(layer.text.alignment || ""),
            lineSpacing: number(layer.text.lineSpacing, 0),
            lineAdvance: number(layer.text.lineAdvance, 0),
            photoshop: layer.text.photoshop ? clone(layer.text.photoshop) : null,
            color: normalizeColor(layer.text.color)
          };
          if (["point", "paragraph"].includes(layer.text.layoutMode)) {
            state.text.layoutMode = layer.text.layoutMode;
          }
        }
        return state;
      }
      function captureBaseline(currentManifest, snapshot) {
        const manifest = clone(currentManifest);
        const layers = {};
        function visit(layer) {
          layers[String(layer.layerId)] = normalizedLayerState(layer);
          (layer.children || []).forEach(visit);
        }
        if (snapshot && snapshot.root) visit(snapshot.root);
        manifest.baseline = {
          revision: Number(manifest.revision) || 0,
          capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
          layers
        };
        return manifest;
      }
      function diffLayerFromBaseline(manifest, layer) {
        const baseline = manifest && manifest.baseline && manifest.baseline.layers ? manifest.baseline.layers[String(layer.layerId)] : null;
        if (!baseline) return ["尚未保存该图层的比较基线"];
        const current = normalizedLayerState(layer);
        const changes = [];
        if (baseline.name !== current.name) changes.push("名称：".concat(baseline.name, " → ").concat(current.name));
        if (baseline.kind !== current.kind) changes.push("类型：".concat(baseline.kind, " → ").concat(current.kind));
        if (JSON.stringify(baseline.bounds) !== JSON.stringify(current.bounds)) changes.push("位置或尺寸已改变");
        if (baseline.visible !== current.visible) changes.push("可见性：".concat(baseline.visible ? "可见" : "隐藏", " → ").concat(current.visible ? "可见" : "隐藏"));
        if (baseline.opacity !== current.opacity) changes.push("不透明度：".concat(baseline.opacity, " → ").concat(current.opacity));
        if (JSON.stringify(baseline.text) !== JSON.stringify(current.text)) changes.push("文本内容或排版已改变");
        if (baseline.styleSignature !== current.styleSignature) changes.push("图层样式已改变");
        return changes;
      }
      function diffSnapshotFromBaseline(manifest, snapshot) {
        const changedLayers = [];
        const currentLayerIds = /* @__PURE__ */ new Set();
        function visit(layer) {
          const layerId = String(layer.layerId);
          currentLayerIds.add(layerId);
          const changes = diffLayerFromBaseline(manifest, layer);
          if (changes.length > 0) {
            changedLayers.push({ layerId, name: String(layer.name || layerId), changes });
          }
          (layer.children || []).forEach(visit);
        }
        if (snapshot && snapshot.root) visit(snapshot.root);
        const baselineLayers = manifest && manifest.baseline && manifest.baseline.layers || {};
        Object.keys(baselineLayers).forEach((layerId) => {
          if (!currentLayerIds.has(layerId)) {
            changedLayers.push({
              layerId,
              name: String(baselineLayers[layerId].name || layerId),
              changes: ["图层已删除或移出界面根组"]
            });
          }
        });
        return changedLayers;
      }
      module.exports = {
        inferSemantic,
        AutomaticImagePolicy,
        inferSourceSemantic,
        projectAutomaticImageSemantics,
        collectUnconfiguredEmptyGroupIds,
        prepareManifestForExport,
        captureBaseline,
        diffLayerFromBaseline,
        diffSnapshotFromBaseline
      };
    }
  });

  // Plus-ins/PSD2UI/generated/core/authoringCommands.js
  var require_authoringCommands = __commonJS({
    "Plus-ins/PSD2UI/generated/core/authoringCommands.js"(exports, module) {
      "use strict";
      var { createPreset } = require_defaults();
      var { createId } = require_ids();
      var { fail } = require_errors();
      var {
        normalizeLayerId,
        normalizeModule,
        normalizeSubmodule,
        allocateResource,
        reuseResource,
        retireResource,
        migrateResource,
        migrateDocumentSubmodule,
        ensureRegistry
      } = require_resourceRegistry();
      var { validateManifest } = require_validation();
      var {
        requiresStructure,
        structureRoleContract,
        validateStructureLayout,
        validateVisualStates,
        planStructuredGroup
      } = require_structure();
      var { prepareManifestForExport, captureBaseline } = require_snapshot();
      function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
      }
      function requireManifest(manifest) {
        if (!manifest || !manifest.document) {
          fail("PSD2UI_MANIFEST_REQUIRED", "请先初始化当前 PSD 文档。");
        }
        return manifest;
      }
      function requireHuman(context, operation) {
        const panelAction = context && context.actor === "human-panel";
        const confirmedStructurePlan = context && context.actor === "human-approved-plan" && operation === "组件结构化" && String(context.confirmationId || "").trim();
        const confirmedSubmodulePlan = context && context.actor === "human-approved-plan" && operation === "PSD 文档 submodule 迁移" && String(context.confirmationId || "").trim();
        if (panelAction || confirmedStructurePlan || confirmedSubmodulePlan) return;
        fail(
          "PSD2UI_HUMAN_CONFIRMATION_REQUIRED",
          "".concat(operation, " 只能由 Photoshop 面板中的人工操作，或由用户明确确认的结构计划执行。")
        );
      }
      function normalizeDocumentModule(moduleName) {
        const value = normalizeModule(moduleName);
        if (value === "common") {
          fail("PSD2UI_DOCUMENT_MODULE_COMMON", "PSD 文档必须绑定业务 module；Common 只能由人工提升具体资源。");
        }
        return value;
      }
      function initializeDocument(input, options) {
        const moduleName = normalizeDocumentModule(input.module || (input.resourceNaming === "source" ? "ui" : ""));
        const submodule = input.submodule == null || String(input.submodule).trim() === "" ? null : normalizeSubmodule(input.submodule);
        const rootLayerId = normalizeLayerId(input.rootLayerId);
        const idFactory = options && options.idFactory ? options.idFactory : createId;
        const width = Number(input.width);
        const height = Number(input.height);
        if (!(width > 0) || !(height > 0)) {
          fail("PSD2UI_DESIGN_SIZE_INVALID", "初始化文档时必须提供大于 0 的 width/height。");
        }
        const name = String(input.name || "").trim();
        if (!name) {
          fail("PSD2UI_DOCUMENT_NAME_REQUIRED", "初始化文档时必须填写界面名称。");
        }
        const rootPreset = createPreset("view");
        rootPreset.id = idFactory("node");
        rootPreset.layerId = rootLayerId;
        rootPreset.name = String(input.rootLayerName || name).trim();
        let manifest = {
          manifestVersion: submodule ? "1.1.0" : "1.0.0",
          revision: 1,
          document: __spreadProps(__spreadValues({
            id: idFactory("document"),
            name,
            module: moduleName
          }, submodule ? { submodule } : {}), {
            width,
            height,
            coordSpace: "parent-top-left-px",
            rootLayerId
          }),
          nodes: { [rootLayerId]: rootPreset },
          resourceRegistry: {
            counters: {},
            resources: {},
            layerBindings: {}
          }
        };
        if (input.resourceNaming === "source") manifest.resourceNaming = "source";
        if (input.snapshot) {
          const snapshotRootId = input.snapshot.root && normalizeLayerId(input.snapshot.root.layerId);
          if (!snapshotRootId || snapshotRootId !== rootLayerId) {
            fail(
              "PSD2UI_INITIAL_SNAPSHOT_ROOT_MISMATCH",
              "初始化快照根图层必须是 ".concat(rootLayerId, "，当前为 ").concat(snapshotRootId || "空", "。")
            );
          }
          manifest = prepareManifestForExport(manifest, input.snapshot, __spreadProps(__spreadValues({}, options || {}), {
            allocateResources: false
          })).manifest;
        }
        return manifest;
      }
      function applyNodePreset(manifest, input, options) {
        requireManifest(manifest);
        const layerId = normalizeLayerId(input.layerId);
        const preset = createPreset(String(input.semantic || "").trim());
        if (!preset) {
          fail("PSD2UI_SEMANTIC_UNSUPPORTED", "语义 '".concat(input.semantic || "", "' 没有确定性组件预设。"));
        }
        const idFactory = options && options.idFactory ? options.idFactory : createId;
        const existing = manifest.nodes[layerId];
        preset.id = existing && existing.id ? existing.id : idFactory("node");
        preset.layerId = layerId;
        preset.name = String(input.name || existing && existing.name || "").trim();
        if (!preset.name) {
          fail("PSD2UI_NODE_NAME_REQUIRED", "图层 ".concat(layerId, " 缺少可见节点名称。"));
        }
        if (existing && existing.visualStates) preset.visualStates = clone(existing.visualStates);
        if (existing && existing.viewport && ["list", "grid"].includes(preset.semantic)) {
          preset.viewport = clone(existing.viewport);
          if (existing.viewportSourceBounds) preset.viewportSourceBounds = clone(existing.viewportSourceBounds);
        }
        manifest.nodes[layerId] = preset;
        return preset;
      }
      function applyStructuredGroup(manifest, input, options) {
        requireManifest(manifest);
        const semantic = String(input.semantic || "").trim();
        if (!requiresStructure(semantic)) {
          fail("PSD2UI_STRUCTURE_SEMANTIC_REQUIRED", "语义 '".concat(semantic, "' 不支持结构化。"));
        }
        const structure = clone(input.structure);
        if (!structure || structure.version !== 1 || !Array.isArray(structure.roles)) {
          fail("PSD2UI_STRUCTURE_REQUIRED", "结构化组件必须提供版本 1 的角色映射。");
        }
        const seenRoles = /* @__PURE__ */ new Set();
        structure.roles.forEach((role, index) => {
          if (!role || !String(role.name || "").trim() || !String(role.layerId || "").trim()) {
            fail("PSD2UI_STRUCTURE_ROLE_INVALID", "第 ".concat(index + 1, " 个结构角色缺少 name 或 layerId。"));
          }
          const key = String(role.name).trim();
          if (seenRoles.has(key)) {
            fail("PSD2UI_STRUCTURE_ROLE_DUPLICATE", "结构角色 '".concat(role.name, "' 重复指向图层 ").concat(role.layerId, "。"));
          }
          seenRoles.add(key);
          role.name = String(role.name).trim();
          role.layerId = normalizeLayerId(role.layerId);
          if (!structureRoleContract(semantic, role.name)) {
            fail("PSD2UI_STRUCTURE_ROLE_INVALID", "".concat(semantic, " 不支持角色 '").concat(role.name, "'。"));
          }
          delete role.nodeId;
        });
        structure.previewLayerIds = Array.isArray(structure.previewLayerIds) ? structure.previewLayerIds.map(normalizeLayerId) : [];
        if (structure.layoutSource != null && !["explicit", "inferred"].includes(structure.layoutSource)) {
          fail("PSD2UI_STRUCTURE_LAYOUT_INVALID", "layoutSource 必须是 explicit 或 inferred。");
        }
        if (structure.layout) validateStructureLayout(semantic, structure.layout);
        const roleSemantics = semantic === "button" ? { background: ["image", "raw-image"], label: ["text"] } : semantic === "input-field" ? { background: ["image"], text: ["text"], placeholder: ["text"] } : semantic === "toggle" ? { background: ["image"], "on-graphic": ["image"], label: ["text"] } : null;
        if (roleSemantics) {
          structure.roles.forEach((role) => {
            const allowedSemantics = roleSemantics[role.name];
            const existing = manifest.nodes[role.layerId];
            if (!allowedSemantics || !existing || allowedSemantics.includes(existing.semantic)) return;
            if (existing.structure) {
              fail("PSD2UI_STRUCTURE_ROLE_CROSSES_COMPONENT", "不能把已配置组件 ".concat(role.layerId, " 隐式改为视觉角色。"));
            }
            applyNodePreset(manifest, {
              layerId: role.layerId,
              name: existing.name,
              semantic: allowedSemantics[0]
            }, options);
          });
        }
        const preset = applyNodePreset(manifest, {
          layerId: input.layerId,
          name: input.name,
          semantic
        }, options);
        preset.authoringSource = "structured";
        preset.structure = structure;
        return preset;
      }
      function updateNodeParameters(manifest, input) {
        requireManifest(manifest);
        const layerId = normalizeLayerId(input.layerId);
        const node = manifest.nodes[layerId];
        if (!node) {
          fail("PSD2UI_NODE_NOT_INITIALIZED", "图层 ".concat(layerId, " 尚未应用组件预设。"));
        }
        const parameters = clone(input.parameters || {});
        const targetKey = node.semantic === "image" ? "image" : node.semantic === "raw-image" ? "rawImage" : node.semantic === "text" ? "text" : node.semantic === "button" ? "button" : null;
        if (!targetKey) {
          const allowed = ["visible", "opacity", "rotationClockwiseDegrees"];
          Object.keys(parameters).forEach((key) => {
            if (!allowed.includes(key)) {
              fail("PSD2UI_PARAMETER_NOT_ALLOWED", "".concat(node.semantic, " 节点不允许参数 '").concat(key, "'。"));
            }
            node[key] = parameters[key];
          });
          return node;
        }
        const componentPatch = parameters[targetKey] || {};
        Object.keys(componentPatch).forEach((key) => {
          if (!Object.prototype.hasOwnProperty.call(node[targetKey], key)) {
            fail("PSD2UI_PARAMETER_NOT_ALLOWED", "".concat(node.semantic, " 预设不允许参数 '").concat(key, "'。"));
          }
          if ((targetKey === "image" || targetKey === "rawImage") && key === "resourceId") {
            fail("PSD2UI_RESOURCE_BIND_COMMAND_REQUIRED", "resourceId 只能通过分配资源或明确复用命令修改。");
          }
          node[targetKey][key] = componentPatch[key];
        });
        ["visible", "opacity", "rotationClockwiseDegrees"].forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(parameters, key)) {
            node[key] = parameters[key];
          }
        });
        return node;
      }
      function requireVisualResourceTarget(manifest, layerId) {
        const node = manifest.nodes[normalizeLayerId(layerId)];
        if (!node || node.semantic !== "image" && node.semantic !== "raw-image") {
          fail("PSD2UI_IMAGE_NODE_REQUIRED", "分配图片资源前必须先为图层应用 image 或 raw-image 预设。");
        }
        return {
          node,
          componentKey: node.semantic === "image" ? "image" : "rawImage",
          resourceKind: node.semantic === "image" ? "sprite" : "texture"
        };
      }
      function setVisualStates(manifest, input) {
        requireManifest(manifest);
        const layerId = normalizeLayerId(input.layerId);
        const node = manifest.nodes[layerId];
        if (!node) fail("PSD2UI_NODE_NOT_INITIALIZED", "图层 ".concat(layerId, " 尚未初始化。"));
        if (input.visualStates == null) {
          delete node.visualStates;
          return node;
        }
        node.visualStates = validateVisualStates(input.visualStates);
        return node;
      }
      function setNodeViewport(manifest, input) {
        requireManifest(manifest);
        const layerId = normalizeLayerId(input.layerId);
        const node = manifest.nodes[layerId];
        if (!node || !["list", "grid"].includes(node.semantic)) {
          fail("PSD2UI_VIEWPORT_NODE_INVALID", "可视区域尺寸只配置在列表或网格组件根上。");
        }
        if (input.viewport == null) {
          delete node.viewport;
          delete node.viewportSourceBounds;
          return node;
        }
        const viewport = input.viewport;
        if (Object.keys(viewport).some((key) => !["width", "height"].includes(key)) || !Number.isFinite(viewport.width) || viewport.width <= 0 || !Number.isFinite(viewport.height) || viewport.height <= 0) {
          fail("PSD2UI_VIEWPORT_INVALID", "可视区域必须明确填写正的 width/height。");
        }
        node.viewport = { width: viewport.width, height: viewport.height };
        delete node.viewportSourceBounds;
        if (input.sourceBounds) {
          if (["left", "top", "right", "bottom"].some((key) => !Number.isFinite(input.sourceBounds[key]))) {
            fail("PSD2UI_VIEWPORT_INVALID", "sourceBounds 必须来自当前组的真实像素边界。");
          }
          node.viewportSourceBounds = clone(input.sourceBounds);
        }
        return node;
      }
      function setCollectionPreviews(manifest, input) {
        requireManifest(manifest);
        const layerId = normalizeLayerId(input.layerId);
        const node = manifest.nodes[layerId];
        if (!node || !["list", "grid"].includes(node.semantic) || !node.structure || !Array.isArray(node.structure.roles)) {
          fail("PSD2UI_STRUCTURE_PREVIEW_NODE_INVALID", "仅预览条目必须配置在已有模板和布局的列表或网格上。");
        }
        if (!Array.isArray(input.previewLayerIds)) {
          fail("PSD2UI_STRUCTURE_PREVIEW_INVALID", "请明确提供 previewLayerIds 数组；空数组表示清除仅预览条目。");
        }
        validateStructureLayout(node.semantic, node.structure.layout);
        const snapshot = input.snapshot;
        if (!snapshot || !snapshot.root) {
          fail("PSD2UI_SNAPSHOT_REQUIRED", "配置仅预览条目需要当前 Photoshop 完整图层树快照。");
        }
        const documentRootId = normalizeLayerId(manifest.document.rootLayerId);
        function findDocumentRoot(layer) {
          if (normalizeLayerId(layer.layerId) === documentRootId) return layer;
          for (const child of layer.children || []) {
            const found = findDocumentRoot(child);
            if (found) return found;
          }
          return null;
        }
        const documentRoot = findDocumentRoot(snapshot.root);
        if (!documentRoot) fail("PSD2UI_SNAPSHOT_ROOT_MISMATCH", "当前快照中找不到已初始化的 PSD 根。");
        const layers = /* @__PURE__ */ new Map();
        function decorate(layer, parentId) {
          const id = normalizeLayerId(layer.layerId);
          if (layers.has(id)) fail("PSD2UI_STRUCTURE_LAYER_ID_INVALID", "快照包含重复图层 ".concat(id, "。"));
          const authored = manifest.nodes[id] || {};
          const current = __spreadProps(__spreadValues({}, layer), {
            layerId: id,
            parentId,
            semantic: authored.semantic,
            structure: authored.structure,
            exportMode: authored.exportMode
          });
          layers.set(id, current);
          current.children = (layer.children || []).map((child) => decorate(child, id));
          return current;
        }
        decorate(documentRoot, "");
        const group = layers.get(layerId);
        if (!group) fail("PSD2UI_STRUCTURE_PREVIEW_NODE_INVALID", "当前 PSD 根中找不到集合图层 ".concat(layerId, "。"));
        const plan = planStructuredGroup(node.semantic, group, {
          roles: node.structure.roles,
          previewLayerIds: input.previewLayerIds,
          layout: node.structure.layout
        });
        const excluded = /* @__PURE__ */ new Set();
        function exclude(layer) {
          excluded.add(layer.layerId);
          layer.children.forEach(exclude);
        }
        plan.structure.previewLayerIds.forEach((id) => exclude(layers.get(id)));
        Object.entries(manifest.nodes).forEach(([ownerId, owner]) => {
          if (excluded.has(ownerId) || !layers.has(ownerId)) return;
          const references = [
            ...owner.structure && owner.structure.roles || [],
            ...owner.visualStates && owner.visualStates.states || []
          ];
          references.forEach((reference) => {
            const targetId = String(reference.layerId);
            if (excluded.has(targetId)) {
              fail(
                "PSD2UI_STRUCTURE_PREVIEW_REFERENCED",
                "图层 ".concat(targetId, " 仍被组件 ").concat(ownerId, " 的角色或视觉状态 '").concat(reference.name, "' 引用，不能设为仅预览。"),
                { layerId, ownerLayerId: ownerId, targetLayerId: targetId }
              );
            }
          });
        });
        node.structure.previewLayerIds = plan.structure.previewLayerIds;
        node.structure.layoutSource = "explicit";
        return node;
      }
      function bindAllocatedResource(manifest, input, options) {
        const target = requireVisualResourceTarget(manifest, input.layerId);
        if (String(input.kind || "").trim().toLowerCase() !== target.resourceKind) {
          fail(
            "PSD2UI_NODE_RESOURCE_KIND",
            "".concat(target.node.semantic, " 节点只能分配 ").concat(target.resourceKind, " 资源。")
          );
        }
        if (input.module != null && normalizeModule(input.module) !== manifest.document.module) {
          fail("PSD2UI_RESOURCE_MODULE_FROM_DOCUMENT", "新资源默认归属当前 PSD 的 module；改变归属必须执行人工迁移。");
        }
        const resource = allocateResource(manifest, {
          layerId: input.layerId,
          layerName: input.layerName || target.node.sourceLayerName || target.node.name,
          kind: input.kind,
          module: manifest.document.module
        }, options);
        target.node[target.componentKey].resourceId = resource.id;
        return resource;
      }
      function bindReusedResource(manifest, input) {
        const target = requireVisualResourceTarget(manifest, input.layerId);
        const resource = reuseResource(manifest, input);
        if (resource.kind !== target.resourceKind) {
          fail(
            "PSD2UI_IMAGE_RESOURCE_KIND",
            "".concat(target.node.semantic, " 节点只能复用 ").concat(target.resourceKind, " 资源。")
          );
        }
        target.node[target.componentKey].resourceId = resource.id;
        return resource;
      }
      function setDocumentModule(manifest, input) {
        requireManifest(manifest);
        manifest.document.module = normalizeDocumentModule(input.module);
        return manifest.document;
      }
      function executeAuthoringCommand(currentManifest, envelope, context, options) {
        if (!envelope || !envelope.command) {
          fail("PSD2UI_COMMAND_REQUIRED", "Authoring Command 名称不能为空。");
        }
        const command = envelope.command;
        const input = envelope.input || {};
        let manifest = clone(currentManifest);
        let value;
        if (command === "initialize-document") {
          manifest = initializeDocument(input, options);
          value = manifest.document;
        } else {
          requireManifest(manifest);
          ensureRegistry(manifest);
          switch (command) {
            case "set-document-module":
              requireHuman(context, "PSD 文档 module 变更");
              value = setDocumentModule(manifest, input);
              break;
            case "set-document-submodule":
              requireHuman(context, "PSD 文档 submodule 迁移");
              value = migrateDocumentSubmodule(manifest, input);
              break;
            case "apply-node-preset":
              value = applyNodePreset(manifest, input, options);
              break;
            case "apply-structured-group":
              requireHuman(context, "组件结构化");
              value = applyStructuredGroup(manifest, input, options);
              break;
            case "update-node-parameters":
              value = updateNodeParameters(manifest, input);
              break;
            case "set-visual-states":
              value = setVisualStates(manifest, input);
              break;
            case "set-node-viewport":
              value = setNodeViewport(manifest, input);
              break;
            case "set-collection-previews":
              value = setCollectionPreviews(manifest, input);
              break;
            case "allocate-resource":
              value = bindAllocatedResource(manifest, input, options);
              break;
            case "reuse-resource":
              value = bindReusedResource(manifest, input);
              break;
            case "retire-resource":
              value = retireResource(manifest, input);
              break;
            case "migrate-resource":
              requireHuman(context, "资源 module/type 迁移");
              value = migrateResource(manifest, input);
              break;
            case "promote-resource-to-common":
              requireHuman(context, "资源提升为 Common");
              value = migrateResource(manifest, {
                resourceId: input.resourceId,
                module: "common",
                submodule: input.submodule,
                kind: input.kind,
                reason: "human-promote-common"
              });
              break;
            case "validate-for-export":
              value = { issues: validateManifest(manifest) };
              break;
            case "prepare-default-export": {
              const prepared = prepareManifestForExport(manifest, input.snapshot, options);
              manifest = prepared.manifest;
              value = {
                diagnostics: prepared.diagnostics,
                reconciliation: prepared.reconciliation
              };
              break;
            }
            case "sync-layer-tree": {
              const prepared = prepareManifestForExport(manifest, input.snapshot, __spreadProps(__spreadValues({}, options || {}), {
                allocateResources: false
              }));
              manifest = prepared.manifest;
              value = {
                diagnostics: prepared.diagnostics,
                reconciliation: prepared.reconciliation
              };
              break;
            }
            case "capture-baseline":
              manifest = captureBaseline(manifest, input.snapshot);
              value = manifest.baseline;
              break;
            default:
              fail("PSD2UI_COMMAND_UNKNOWN", "未知 Authoring Command：".concat(command));
          }
          manifest.revision = (Number(manifest.revision) || 0) + 1;
        }
        return { manifest, value };
      }
      module.exports = {
        initializeDocument,
        applyNodePreset,
        applyStructuredGroup,
        updateNodeParameters,
        setVisualStates,
        setNodeViewport,
        setCollectionPreviews,
        executeAuthoringCommand
      };
    }
  });

  // Plus-ins/PSD2UI/generated/core/nineSlice.js
  var require_nineSlice = __commonJS({
    "Plus-ins/PSD2UI/generated/core/nineSlice.js"(exports, module) {
      "use strict";
      var { fail } = require_errors();
      function normalizeSliceBorder(value, width, height) {
        if (!value) return null;
        const result = {};
        for (const key of ["left", "top", "right", "bottom"]) {
          const number = Number(value[key]);
          if (!Number.isInteger(number) || number < 0) {
            fail("PSD2UI_SLICE_BORDER_INVALID", "九宫参数 ".concat(key, " 必须是大于或等于 0 的整数。"));
          }
          result[key] = number;
        }
        if (result.left + result.right >= width || result.top + result.bottom >= height) {
          fail(
            "PSD2UI_SLICE_BORDER_OUT_OF_RANGE",
            "九宫固定边超出图片范围：图片 ".concat(width, "×").concat(height, "，边距 ").concat(result.left, ",").concat(result.top, ",").concat(result.right, ",").concat(result.bottom, "。")
          );
        }
        return result;
      }
      function sourceCoordinate(outputCoordinate, leading, trailing, sourceSize) {
        if (outputCoordinate < leading) return outputCoordinate;
        if (outputCoordinate === leading) return leading;
        return sourceSize - trailing + outputCoordinate - leading - 1;
      }
      function collapseNineSlicePixels(source, width, height, components, sliceBorder) {
        if (!source || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || !Number.isInteger(components) || components <= 0) {
          fail("PSD2UI_SLICE_PIXEL_INPUT_INVALID", "九宫像素处理缺少有效的图片尺寸或分量数。");
        }
        if (source.length !== width * height * components) {
          fail("PSD2UI_SLICE_PIXEL_LENGTH_INVALID", "九宫像素缓冲区长度与图片尺寸不一致。");
        }
        const border = normalizeSliceBorder(sliceBorder, width, height);
        const outputWidth = border.left + 1 + border.right;
        const outputHeight = border.top + 1 + border.bottom;
        const output = new source.constructor(outputWidth * outputHeight * components);
        for (let y = 0; y < outputHeight; y += 1) {
          const sourceY = sourceCoordinate(y, border.top, border.bottom, height);
          for (let x = 0; x < outputWidth; x += 1) {
            const sourceX = sourceCoordinate(x, border.left, border.right, width);
            const sourceOffset = (sourceY * width + sourceX) * components;
            const outputOffset = (y * outputWidth + x) * components;
            for (let component = 0; component < components; component += 1) {
              output[outputOffset + component] = source[sourceOffset + component];
            }
          }
        }
        return { pixels: output, width: outputWidth, height: outputHeight, border };
      }
      module.exports = { normalizeSliceBorder, collapseNineSlicePixels };
    }
  });

  // Plus-ins/PSD2UI/generated/core/bundle.js
  var require_bundle = __commonJS({
    "Plus-ins/PSD2UI/generated/core/bundle.js"(exports, module) {
      "use strict";
      var { assertManifestValid } = require_validation();
      var { fail } = require_errors();
      var { ensureRegistry } = require_resourceRegistry();
      var { prepareManifestForExport, collectUnconfiguredEmptyGroupIds } = require_snapshot();
      var { normalizeSliceBorder } = require_nineSlice();
      var { collectInvalidImageLayerNames, collectInvalidLayerNames, stripLegacyLayerSuffix } = require_naming();
      function prepareSourceManifest(manifest, snapshot, options) {
        const source = JSON.parse(JSON.stringify(manifest || null));
        if (!source || !source.document) fail("PSD2UI_MANIFEST_REQUIRED", "源命名升级需要已初始化的文档。");
        source.resourceNaming = "source";
        const issues = collectInvalidImageLayerNames(snapshot, source);
        if (issues.length) fail("PSD2UI_IMAGE_NAMES_INVALID", "图片命名检查未通过；源命名草稿未保存。", { diagnostics: issues });
        return prepareManifestForExport(source, snapshot, __spreadProps(__spreadValues({}, options || {}), { allocateResources: true }));
      }
      function preflightBundle(manifest, snapshot) {
        const namingIssues = manifest && manifest.resourceNaming === "source" ? collectInvalidImageLayerNames(snapshot, manifest) : [];
        if (namingIssues.length) return { status: "blocked", issues: namingIssues, bundle: null };
        try {
          return { status: "ready", issues: [], bundle: buildBundle(manifest, snapshot) };
        } catch (error) {
          const issues = error.issues || error.details && error.details.diagnostics || [__spreadValues({
            severity: "error",
            code: error.code || "PSD2UI_PREFLIGHT_FAILED",
            message: error.message
          }, error.details || {})];
          return { status: "blocked", issues, bundle: null };
        }
      }
      function number(value, label, details) {
        const parsed = value && typeof value === "object" && "value" in value ? Number(value.value) : Number(value);
        if (!Number.isFinite(parsed)) {
          fail("PSD2UI_GEOMETRY_INVALID", "".concat(label, " 不是有效数值。"), details);
        }
        return parsed;
      }
      function normalizeBounds(bounds, label, details) {
        if (!bounds) {
          fail("PSD2UI_BOUNDS_REQUIRED", "".concat(label, " 缺少 bounds。"), details);
        }
        const left = number(bounds.left, "".concat(label, ".left"), details);
        const top = number(bounds.top, "".concat(label, ".top"), details);
        const right = number(bounds.right, "".concat(label, ".right"), details);
        const bottom = number(bounds.bottom, "".concat(label, ".bottom"), details);
        if (right < left || bottom < top) {
          fail("PSD2UI_BOUNDS_INVALID", "".concat(label, " 的 bounds 顺序无效。"), details);
        }
        return { left, top, right, bottom };
      }
      function indexSnapshot(root) {
        const byId = {};
        function visit(layer) {
          if (!layer) return;
          const id = String(layer.layerId == null ? "" : layer.layerId);
          if (!id) {
            fail("PSD2UI_SNAPSHOT_LAYER_ID_REQUIRED", "Photoshop 快照中存在缺少 layerId 的图层。");
          }
          byId[id] = layer;
          (layer.children || []).forEach(visit);
        }
        visit(root);
        return byId;
      }
      function cloneComponent(value) {
        return value ? JSON.parse(JSON.stringify(value)) : null;
      }
      function buildBundle(manifest, snapshot) {
        if (!snapshot || !snapshot.root) {
          fail("PSD2UI_SNAPSHOT_REQUIRED", "导出时必须提供当前 Photoshop 图层树快照。");
        }
        if (manifest && manifest.resourceNaming === "source") {
          const issues = collectInvalidImageLayerNames(snapshot, manifest);
          if (issues.length) fail("PSD2UI_IMAGE_NAMES_INVALID", "图片命名检查未通过；请定位并修正图片图层。", { diagnostics: issues });
        } else if (collectInvalidLayerNames(snapshot).length) {
          fail("PSD2UI_LAYER_NAME_ENGLISH_REQUIRED", "旧版资源编号模式仅支持英文标识符图层名：" + collectInvalidLayerNames(snapshot).map((entry) => "".concat(entry.layerId, ":").concat(entry.name)).join("、"));
        }
        const prepared = prepareManifestForExport(manifest, snapshot);
        const exportManifest = prepared.manifest;
        const blockingDiagnostics = prepared.diagnostics.filter((entry) => entry && entry.severity === "error");
        if (blockingDiagnostics.length > 0) {
          fail(
            "PSD2UI_STRUCTURE_INVALID_FOR_EXPORT",
            "组件结构不完整，共 ".concat(blockingDiagnostics.length, " 项；请在 Photoshop 面板重新结构化后再导出。"),
            { diagnostics: blockingDiagnostics }
          );
        }
        const registry = ensureRegistry(exportManifest);
        const rootLayerId = String(exportManifest.document.rootLayerId);
        const byId = indexSnapshot(snapshot.root);
        const snapshotRoot = byId[rootLayerId];
        if (!snapshotRoot) {
          fail("PSD2UI_ROOT_LAYER_MISSING", "当前 PSD 中找不到根图层 ".concat(rootLayerId, "。"), { layerId: rootLayerId });
        }
        const usedResources = /* @__PURE__ */ new Map();
        const resourceSourceLayers = /* @__PURE__ */ new Map();
        const sourceNaming = exportManifest.resourceNaming === "source";
        const diagnostics = prepared.diagnostics.slice();
        const previewLayerIds = /* @__PURE__ */ new Set();
        const stateVisibility = /* @__PURE__ */ new Map();
        const runtimeNodes = /* @__PURE__ */ new Map();
        const emptyGroupIds = collectUnconfiguredEmptyGroupIds(snapshotRoot, exportManifest);
        function collectRuntimeNodes(layer) {
          const layerId = String(layer.layerId);
          const authored = exportManifest.nodes[layerId];
          if (previewLayerIds.has(layerId) || emptyGroupIds.has(layerId) || authored.semantic === "ignore" || authored.exportMode === "preview-only") return;
          runtimeNodes.set(layerId, authored);
          const structure = authored.structure;
          (structure && structure.previewLayerIds || []).forEach((previewLayerId) => {
            previewLayerIds.add(String(previewLayerId));
          });
          (layer.children || []).forEach(collectRuntimeNodes);
        }
        collectRuntimeNodes(snapshotRoot);
        runtimeNodes.forEach((authored) => {
          if (sourceNaming && authored.visualStates) {
            const visualStates = authored.visualStates;
            if (!Array.isArray(visualStates.states) || !visualStates.states.length || !visualStates.states.some((state) => state.name === visualStates.defaultState)) {
              fail("PSD2UI_VISUAL_STATES_INVALID", "节点 '".concat(authored.name, "' 的默认状态必须引用一个已声明状态。"), { layerId: authored.layerId, nodeId: authored.id });
            }
            const names = /* @__PURE__ */ new Set();
            const ids = /* @__PURE__ */ new Set();
            visualStates.states.forEach((state) => {
              const id = String(state.layerId);
              if (!state.name || names.has(state.name) || ids.has(id) || !runtimeNodes.has(id)) {
                fail("PSD2UI_VISUAL_STATES_INVALID", "节点 '".concat(authored.name, "' 存在重复或缺失的状态组 ").concat(id, "。"), { layerId: authored.layerId, nodeId: authored.id, otherLayerId: id });
              }
              names.add(state.name);
              ids.add(id);
              if (stateVisibility.has(id)) fail("PSD2UI_VISUAL_STATE_OWNER_CONFLICT", "状态组 ".concat(id, " 同时属于多个状态集合。"), { layerId: id, nodeId: authored.id });
              stateVisibility.set(id, state.name === visualStates.defaultState ? "enabled" : "disabled");
            });
          }
        });
        if (sourceNaming) {
          const nodes = {};
          const referenced = /* @__PURE__ */ new Set();
          runtimeNodes.forEach((node, id) => {
            nodes[id] = node;
            [node.image && node.image.resourceId, node.rawImage && node.rawImage.resourceId].filter(Boolean).forEach((resourceId) => referenced.add(resourceId));
          });
          const resources2 = {};
          referenced.forEach((resourceId) => {
            if (registry.resources[resourceId]) resources2[resourceId] = registry.resources[resourceId];
          });
          assertManifestValid(__spreadProps(__spreadValues({}, exportManifest), {
            nodes,
            resourceRegistry: __spreadProps(__spreadValues({}, registry), { resources: resources2 })
          }));
        } else assertManifestValid(exportManifest);
        function compileStructure(authored) {
          if (!authored.structure) return null;
          let complete = true;
          const roles = authored.structure.roles.map((role) => {
            const target = exportManifest.nodes[String(role.layerId)];
            if (!target || !runtimeNodes.has(String(role.layerId))) {
              complete = false;
              diagnostics.push({
                severity: "warning",
                code: "PSD2UI_STRUCTURE_ROLE_MISSING",
                nodeId: authored.id || "",
                message: "组件 '".concat(authored.name, "' 的角色 '").concat(role.name, "' 指向的图层 ").concat(role.layerId, " 已缺失或不可导出。")
              });
            }
            return {
              name: role.name,
              nodeId: target && runtimeNodes.has(String(role.layerId)) ? target.id : null
            };
          });
          return __spreadValues({
            version: 1,
            status: complete ? "complete" : "incomplete",
            roles
          }, authored.structure.layout ? { layout: cloneComponent(authored.structure.layout) } : {});
        }
        function useResource(resourceId, sliceBorder, width, height, layerId) {
          if (!resourceId) return;
          if (!resourceSourceLayers.has(resourceId)) resourceSourceLayers.set(resourceId, /* @__PURE__ */ new Set());
          resourceSourceLayers.get(resourceId).add(layerId);
          let normalizedSlice = null;
          if (sliceBorder) {
            try {
              normalizedSlice = normalizeSliceBorder(sliceBorder, Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
            } catch (error) {
              error.details = __spreadProps(__spreadValues({}, error.details || {}), { layerId, resourceId });
              throw error;
            }
          }
          if (usedResources.has(resourceId)) {
            const existing = usedResources.get(resourceId);
            if (JSON.stringify(existing) !== JSON.stringify(normalizedSlice)) {
              fail("PSD2UI_SLICE_RESOURCE_CONFLICT", "资源 '".concat(resourceId, "' 被多个节点以不同九宫参数复用。"), { resourceId, layerIds: [...resourceSourceLayers.get(resourceId)] });
            }
            return;
          }
          usedResources.set(resourceId, normalizedSlice);
        }
        function compile(layer, parentBounds, isRoot) {
          const layerId = String(layer.layerId);
          if (!runtimeNodes.has(layerId)) return null;
          const authored = exportManifest.nodes[layerId];
          if (authored.semantic === "ignore") {
            return null;
          }
          const bounds = normalizeBounds(layer.bounds, "layer:".concat(layerId), { layerId, nodeId: authored.id, name: layer.name });
          const reference = isRoot ? { left: bounds.left, top: bounds.top } : parentBounds;
          const node = {
            id: authored.id,
            sourceLayerId: layerId,
            // Bundle 保留美术维护的 Photoshop 基础名；Unity Adapter 可根据明确语义添加组件前缀。
            name: stripLegacyLayerSuffix(authored.name || layer.name),
            semantic: authored.semantic,
            authoringSource: authored.authoringSource || "explicit",
            structure: compileStructure(authored),
            defaultsVersion: authored.presetVersion,
            rect: {
              x: isRoot ? 0 : bounds.left - reference.left,
              y: isRoot ? 0 : bounds.top - reference.top,
              width: isRoot ? exportManifest.document.width : bounds.right - bounds.left,
              height: isRoot ? exportManifest.document.height : bounds.bottom - bounds.top
            },
            visible: stateVisibility.has(layerId) ? stateVisibility.get(layerId) : authored.visible,
            opacity: authored.opacity,
            rotationClockwiseDegrees: authored.rotationClockwiseDegrees,
            image: cloneComponent(authored.image),
            rawImage: cloneComponent(authored.rawImage),
            text: cloneComponent(authored.text),
            button: cloneComponent(authored.button),
            children: []
          };
          if (!sourceNaming && node.text) delete node.text.layoutMode;
          if (sourceNaming && authored.viewport) {
            node.rect.width = authored.viewport.width;
            node.rect.height = authored.viewport.height;
          }
          if (sourceNaming && authored.visualStates) {
            node.visualStates = {
              defaultState: authored.visualStates.defaultState,
              states: authored.visualStates.states.map((state) => ({
                name: state.name,
                nodeId: exportManifest.nodes[String(state.layerId)].id
              }))
            };
          }
          if (node.image && node.image.resourceId) {
            useResource(node.image.resourceId, node.image.sliceBorder, node.rect.width, node.rect.height, layerId);
          }
          if (node.rawImage && node.rawImage.resourceId) useResource(node.rawImage.resourceId, null, 0, 0, layerId);
          if (node.semantic === "list" || node.semantic === "grid") {
            diagnostics.push({
              severity: "warning",
              code: "PSD2UI_MODULE_INCOMPLETE",
              nodeId: node.id,
              message: "节点 '".concat(node.name, "' 已导出模板与布局，业务数据及条目交互仍需在目标项目绑定。")
            });
          }
          (layer.children || []).forEach((child) => {
            const compiled = compile(child, bounds, false);
            if (compiled) node.children.push(compiled);
          });
          return node;
        }
        const root = compile(snapshotRoot, null, true);
        const submodule = exportManifest.document.submodule || null;
        const resources = Array.from(usedResources.keys()).map((resourceId) => {
          const resource = registry.resources[resourceId];
          if (!resource || resource.status !== "active") {
            fail("PSD2UI_BUNDLE_RESOURCE_MISSING", "Bundle 引用了无效资源 '".concat(resourceId, "'。"), { resourceId, layerIds: [...resourceSourceLayers.get(resourceId) || []] });
          }
          const sourceLayerIds = Array.from(resourceSourceLayers.get(resourceId) || []);
          const sourceLayerId = sourceLayerIds.includes(String(resource.sourceLayerId)) ? String(resource.sourceLayerId) : sourceLayerIds[0];
          return __spreadProps(__spreadValues(__spreadProps(__spreadValues({
            id: resource.id,
            kind: resource.kind,
            scope: resource.scope,
            module: resource.module
          }, !sourceNaming && submodule ? { submodule: resource.submodule } : {}), {
            number: resource.number,
            fileName: resource.fileName,
            sourceLayerId: sourceNaming ? sourceLayerId : resource.sourceLayerId
          }), sourceNaming ? { sourceLayerIds } : {}), {
            sliceBorder: usedResources.get(resourceId)
          });
        }).sort((left, right) => left.fileName.localeCompare(right.fileName));
        return {
          // 1.4 保留基础名契约，补齐 List/Grid 的结构布局；旧版本仍由 Reader 兼容。
          schemaVersion: sourceNaming ? "1.5.0" : "1.4.0",
          generator: "YoyoEngine.PSD2UI",
          document: __spreadProps(__spreadValues({
            id: exportManifest.document.id,
            name: exportManifest.document.name,
            module: exportManifest.document.module
          }, submodule ? { submodule } : {}), {
            width: exportManifest.document.width,
            height: exportManifest.document.height,
            coordSpace: exportManifest.document.coordSpace
          }),
          resources,
          diagnostics,
          root
        };
      }
      module.exports = { buildBundle, preflightBundle, prepareSourceManifest };
    }
  });

  // Plus-ins/PSD2UI/generated/core/selection.js
  var require_selection = __commonJS({
    "Plus-ins/PSD2UI/generated/core/selection.js"(exports, module) {
      "use strict";
      var {
        StructuredSemantics,
        isGroupLayer,
        normalizeLayerKind,
        planStructuredSelection,
        describeStructuredSelection
      } = require_structure();
      var ComponentSemantics = Object.freeze([
        "image",
        "raw-image",
        "text",
        "button",
        "input-field",
        "toggle",
        "list",
        "grid",
        "red-point",
        "toggle-page-group",
        "list-page-group",
        "ignore"
      ]);
      var SemanticLabels = Object.freeze({
        image: "图片",
        "raw-image": "大图",
        text: "文本",
        button: "按钮",
        "input-field": "输入框",
        toggle: "开关",
        list: "列表",
        grid: "网格",
        "red-point": "红点",
        "toggle-page-group": "页签页面组",
        "list-page-group": "列表页面组",
        ignore: "忽略子树"
      });
      var DirectPolicies = Object.freeze({
        image: Object.freeze({ kinds: ["image"], requirement: "1 张图片图层" }),
        "raw-image": Object.freeze({ kinds: ["image"], requirement: "1 张图片图层" }),
        text: Object.freeze({ kinds: ["text"], requirement: "1 个文本图层" }),
        button: Object.freeze({ kinds: ["image"], requirement: "1 张图片图层" }),
        "red-point": Object.freeze({ kinds: ["image", "group"], requirement: "1 张图片或 1 个组" }),
        ignore: Object.freeze({ kinds: ["image", "text", "group"], requirement: "1 个图层或组" })
      });
      function summarizeSelection(layers) {
        const counts = { image: 0, text: 0, group: 0 };
        layers.forEach((layer) => {
          counts[normalizeLayerKind(layer)] += 1;
        });
        return "".concat(layers.length, " 个图层（").concat(counts.image, " 张图片、").concat(counts.text, " 个文本、").concat(counts.group, " 个组）");
      }
      function evaluateDirect(semantic, layers) {
        const policy = DirectPolicies[semantic];
        if (!policy) {
          return {
            canApply: false,
            applyReason: "".concat(SemanticLabels[semantic], "必须通过“结构化所选图层”创建，不能直接写入单个图层。")
          };
        }
        const valid = layers.length === 1 && policy.kinds.includes(normalizeLayerKind(layers[0]));
        return {
          canApply: valid,
          applyReason: valid ? "当前选择可直接写入".concat(SemanticLabels[semantic], "语义。") : "".concat(SemanticLabels[semantic], "直接写入要求 ").concat(policy.requirement, "；当前选择了 ").concat(summarizeSelection(layers), "。")
        };
      }
      function evaluateStructure(semantic, layers, options) {
        if (!StructuredSemantics.has(semantic)) {
          return {
            canStructure: false,
            structureReason: "".concat(SemanticLabels[semantic], "不使用结构化建组。")
          };
        }
        if (semantic === "button" && layers.length === 1 && normalizeLayerKind(layers[0]) === "image") {
          return {
            canStructure: false,
            structureReason: "单图片按钮直接写入即可；选择“图片 + 文本”时再使用结构化。"
          };
        }
        if (layers.length === 0 || layers.length === 1 && !isGroupLayer(layers[0])) {
          return {
            canStructure: false,
            structureReason: "".concat(SemanticLabels[semantic], "需要 1 个现有 Photoshop 组或至少 2 个同级图层；") + "当前选择了 ".concat(summarizeSelection(layers), "。")
          };
        }
        try {
          const description = describeStructuredSelection(semantic, layers, options);
          if (description.needsConfiguration) {
            return {
              canStructure: false,
              canConfigure: description.roles.every((entry) => !entry.required || entry.candidates.length > 0),
              requiresGroup: description.requiresGroup,
              configuration: description,
              structureReason: description.issues.map((issue) => issue.message).join(" ")
            };
          }
          return {
            canStructure: true,
            canConfigure: true,
            requiresGroup: description.requiresGroup,
            configuration: description,
            structureReason: description.requiresGroup ? "可把当前同级图层组合为".concat(SemanticLabels[semantic], "。") : "当前组可配置为".concat(SemanticLabels[semantic], "。")
          };
        } catch (error) {
          return {
            canStructure: false,
            structureReason: error && error.message ? error.message : "当前选择不能结构化为".concat(SemanticLabels[semantic], "。")
          };
        }
      }
      function isCurrentStructuredRoot(semantic, layers) {
        return layers.length === 1 && isGroupLayer(layers[0]) && layers[0].semantic === semantic && layers[0].structure && Array.isArray(layers[0].structure.roles);
      }
      function evaluateSemanticAvailability(selectedLayers, options) {
        const layers = Array.isArray(selectedLayers) ? selectedLayers.filter(Boolean) : [];
        return ComponentSemantics.map((semantic) => {
          const direct = evaluateDirect(semantic, layers);
          const settings = options && options.bySemantic ? options.bySemantic[semantic] : options;
          const structured = evaluateStructure(semantic, layers, settings);
          const currentStructuredRoot = isCurrentStructuredRoot(semantic, layers);
          let reason;
          if (direct.canApply && structured.canStructure) {
            reason = "".concat(direct.applyReason, " ").concat(structured.structureReason);
          } else if (direct.canApply) {
            reason = direct.applyReason;
          } else if (structured.canStructure) {
            reason = structured.structureReason;
          } else if (currentStructuredRoot) {
            reason = "当前组已经配置为".concat(SemanticLabels[semantic], "。").concat(structured.structureReason);
          } else {
            reason = StructuredSemantics.has(semantic) ? structured.structureReason : direct.applyReason;
          }
          return {
            semantic,
            canApply: direct.canApply,
            canStructure: structured.canStructure,
            canConfigure: Boolean(structured.canConfigure),
            requiresGroup: Boolean(structured.requiresGroup),
            configuration: structured.configuration || null,
            applyReason: direct.applyReason,
            structureReason: structured.structureReason,
            currentStructuredRoot: Boolean(currentStructuredRoot),
            enabled: direct.canApply || structured.canStructure || Boolean(structured.canConfigure) || Boolean(currentStructuredRoot),
            reason
          };
        });
      }
      function requireSemanticAction(selectedLayers, semantic, actionName, options) {
        const entry = evaluateSemanticAvailability(selectedLayers, { bySemantic: { [semantic]: options } }).find((candidate) => candidate.semantic === semantic);
        const property = actionName === "configure" ? "canConfigure" : actionName === "structure" ? "canStructure" : "canApply";
        if (!entry || !entry[property]) {
          const actionReason = actionName === "structure" ? entry && entry.structureReason : entry && entry.applyReason;
          const error = new Error(actionReason || entry && entry.reason || "组件类型 '".concat(semantic, "' 未注册。"));
          error.code = actionName === "structure" ? "PSD2UI_STRUCTURE_SELECTION_INVALID" : "PSD2UI_DIRECT_SELECTION_INVALID";
          throw error;
        }
        if (actionName === "structure") planStructuredSelection(semantic, selectedLayers, options);
        return entry;
      }
      module.exports = {
        ComponentSemantics,
        SemanticLabels,
        evaluateSemanticAvailability,
        requireSemanticAction,
        summarizeSelection
      };
    }
  });

  // Plus-ins/PSD2UI/generated/core/index.js
  var require_core = __commonJS({
    "Plus-ins/PSD2UI/generated/core/index.js"(exports, module) {
      "use strict";
      var commands = require_authoringCommands();
      var registry = require_resourceRegistry();
      var validation = require_validation();
      var bundle = require_bundle();
      var errors = require_errors();
      var structure = require_structure();
      var selection = require_selection();
      var snapshot = require_snapshot();
      var nineSlice = require_nineSlice();
      var naming = require_naming();
      module.exports = __spreadValues(__spreadValues(__spreadValues(__spreadValues(__spreadValues(__spreadValues(__spreadValues(__spreadValues(__spreadValues(__spreadValues({}, commands), registry), validation), bundle), errors), structure), selection), snapshot), nineSlice), naming);
    }
  });

  // Plus-ins/PSD2UI/src/preflightIssues.js
  var require_preflightIssues = __commonJS({
    "Plus-ins/PSD2UI/src/preflightIssues.js"(exports, module) {
      "use strict";
      function describePreflightIssues(error, manifest, snapshot) {
        const byLayerId = /* @__PURE__ */ new Map();
        function visit(layer, parents) {
          if (!layer) return;
          const id = String(layer.layerId || layer.id || "");
          const path = [...parents, String(layer.name || id)];
          byLayerId.set(id, { id, name: String(layer.name || id), path: path.join(" / "), layer });
          (layer.children || []).forEach((child) => visit(child, path));
        }
        visit(snapshot && snapshot.root, []);
        const nodes = manifest && manifest.nodes || {};
        const nodeIds = new Map(Object.entries(nodes).map(([id, node]) => [String(node.id), id]));
        const resources = manifest && manifest.resourceRegistry && manifest.resourceRegistry.resources || {};
        const details = error && error.details || {};
        const entries = error && Array.isArray(error.issues) && error.issues.length ? error.issues : Array.isArray(details.diagnostics) && details.diagnostics.length ? details.diagnostics : [error || {}];
        return entries.map((entry) => {
          const issue = __spreadProps(__spreadValues(__spreadValues({}, entry.details || {}), entry), { message: entry.message });
          const ids = /* @__PURE__ */ new Set();
          const add = (id) => {
            if (id != null && String(id)) ids.add(String(id));
          };
          [issue.layerId, issue.sourceLayerId, issue.otherLayerId].forEach(add);
          [issue.layerIds, issue.sourceLayerIds].forEach((values) => {
            if (Array.isArray(values)) values.forEach(add);
          });
          if (issue.nodeId && nodeIds.has(String(issue.nodeId))) add(nodeIds.get(String(issue.nodeId)));
          const path = String(issue.path || "");
          const nodePath = /^nodes\.([^.\[]+)/.exec(path);
          if (nodePath) add(nodePath[1]);
          if (path === "document.rootLayerId") add(manifest && manifest.document && manifest.document.rootLayerId);
          const resourcePath = /^resourceRegistry\.resources\.([^.\[]+)/.exec(path);
          const resourceId = issue.resourceId || resourcePath && resourcePath[1];
          if (resourceId) {
            const resource = resources[resourceId];
            if (resource) {
              add(resource.sourceLayerId);
              (resource.sourceLayerIds || []).forEach(add);
            }
            Object.entries(nodes).forEach(([id, node]) => {
              if (node.image && node.image.resourceId === resourceId || node.rawImage && node.rawImage.resourceId === resourceId) add(id);
            });
          }
          const legacyLayer = /\blayer:([^\s.]+)/.exec(String(issue.message || ""));
          if (!ids.size && legacyLayer) add(legacyLayer[1]);
          const layers = [...ids].map((id) => {
            const found = byLayerId.get(id);
            return found ? { id, name: found.name, path: found.path, canLocate: id !== "document-root" } : { id, name: nodes[id] && nodes[id].name || "图层 ".concat(id), path: "此图层已删除或不在当前文档中", canLocate: false };
          });
          const code = issue.code || error && error.code || "PSD2UI_PREFLIGHT_FAILED";
          let message = issue.message || error && error.message || String(error);
          let hint = layers.some((layer) => layer.canLocate) ? "点击定位后检查该图层；修改完成请重新预检。" : layers.length ? "请检查引用此图层的组件，重新指定角色后再预检。" : "这是文档或导出设置问题，没有可定位的单个图层。";
          if (["PSD2UI_GEOMETRY_INVALID", "PSD2UI_BOUNDS_REQUIRED", "PSD2UI_BOUNDS_INVALID"].includes(code)) {
            const emptyGroup = layers.some((target) => {
              const found = byLayerId.get(target.id);
              return found && String(found.layer.kind).toLowerCase() === "group" && !(found.layer.children || []).length;
            });
            message = emptyGroup ? "这是一个空图层组，Photoshop 没有提供有效的图层边界。" : "图层的位置或尺寸无效，无法计算导出区域。";
            hint = emptyGroup ? "不需要导出时可设为「忽略子树」；需要使用时请补齐组内内容，然后重新预检。" : "定位后检查图层内容、位置和尺寸，然后重新预检。";
          }
          return { code, message, hint, layers, rawMessage: issue.message || error && error.message || "", path };
        });
      }
      module.exports = { describePreflightIssues };
    }
  });

  // Plus-ins/PSD2UI-CEP/src/xmpStore.js
  var require_xmpStore = __commonJS({
    "Plus-ins/PSD2UI-CEP/src/xmpStore.js"(exports, module) {
      "use strict";
      var fs = require_native().requireNative("fs");
      var NamespaceUri = "https://yoyoengine.dev/psd2ui/1.0/";
      var NamespacePrefix = "yoyoPsd2ui";
      var PropertyName = "Manifest";
      function photoshop() {
        return require_photoshop();
      }
      function fileCall(method, args) {
        return new Promise(function(resolve, reject) {
          fs[method].apply(fs, args.concat(function(error, result) {
            if (error) reject(error);
            else resolve(result);
          }));
        });
      }
      function requireLocalDocument() {
        const document2 = photoshop().app.activeDocument;
        if (!document2) throw new Error("当前没有打开的 Photoshop 文档。");
        if (!String(document2.path || "") || /^cloud:/i.test(document2.path)) {
          throw new Error("PSD2UI 配置镜像要求先把 PSD 保存为本地文件。");
        }
        return document2;
      }
      function assertActiveDocument(document2) {
        if (String(requireLocalDocument().id) !== String(document2.id)) {
          throw new Error("保存配置期间切换了 PSD，已停止写入，请回到原文档重试。");
        }
      }
      function getSidecarPath(document2) {
        const nativePath = String((document2 || requireLocalDocument()).path || "");
        if (!nativePath) throw new Error("无法取得当前 PSD 的本地路径。");
        return /\.[^./\\]+$/.test(nativePath) ? nativePath.replace(/\.[^./\\]+$/, ".psd2ui.authoring.json") : nativePath + ".psd2ui.authoring.json";
      }
      async function getDocumentXmp(document2) {
        const source = document2 || requireLocalDocument();
        const result = await photoshop().invoke("getXmp", { documentID: source.id });
        return typeof result === "string" ? result : result && result.rawXmp || "";
      }
      async function setDocumentXmp(rawXmp, document2) {
        const source = document2 || requireLocalDocument();
        await photoshop().invoke("setXmp", { documentID: source.id, rawXmp: String(rawXmp || "") });
      }
      async function readManifest(document2) {
        const source = document2 || requireLocalDocument();
        const result = await photoshop().invoke("readManifest", { documentID: source.id, serialized: true });
        return typeof result === "string" ? JSON.parse(result) : result || null;
      }
      async function writeSidecar(manifest, document2) {
        const sidecarPath = getSidecarPath(document2);
        const serialized = JSON.stringify(manifest, null, 2);
        await fileCall("writeFile", [sidecarPath, serialized, { encoding: "utf8" }]);
        if (await fileCall("readFile", [sidecarPath, "utf8"]) !== serialized) {
          throw new Error("同目录配置文件写入后读回不一致：" + sidecarPath);
        }
        return sidecarPath;
      }
      async function readSidecarManifest(document2) {
        const sidecarPath = getSidecarPath(document2);
        try {
          return { path: sidecarPath, manifest: JSON.parse(await fileCall("readFile", [sidecarPath, "utf8"])) };
        } catch (_) {
          return { path: sidecarPath, manifest: null };
        }
      }
      async function readSidecarRaw(document2) {
        const sidecarPath = getSidecarPath(document2);
        try {
          return { path: sidecarPath, exists: true, serialized: await fileCall("readFile", [sidecarPath, "utf8"]) };
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          return { path: sidecarPath, exists: false, serialized: null };
        }
      }
      async function restoreSidecarRaw(backup) {
        if (!backup || !backup.path) throw new Error("恢复同目录配置时缺少备份路径。");
        if (!backup.exists) {
          try {
            await fileCall("unlink", [backup.path]);
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          return;
        }
        await fileCall("writeFile", [backup.path, backup.serialized, { encoding: "utf8" }]);
        if (await fileCall("readFile", [backup.path, "utf8"]) !== backup.serialized) {
          throw new Error("恢复同目录配置后读回不一致：" + backup.path);
        }
      }
      async function writeManifestInCurrentModal(manifest, saveDocument) {
        const document2 = requireLocalDocument();
        const serializedManifest = JSON.stringify(manifest);
        assertActiveDocument(document2);
        await photoshop().invoke("writeManifest", {
          documentID: document2.id,
          serializedManifest,
          namespaceUri: NamespaceUri,
          namespacePrefix: NamespacePrefix,
          propertyName: PropertyName
        });
        assertActiveDocument(document2);
        const verified = await readManifest(document2);
        if (JSON.stringify(verified) !== serializedManifest) {
          throw new Error("PSD Manifest 写入后读回不一致，已停止保存文档。");
        }
        assertActiveDocument(document2);
        const sidecarPath = await writeSidecar(manifest, document2);
        assertActiveDocument(document2);
        if (saveDocument !== false) await document2.save();
        return { sidecarPath };
      }
      async function writeManifest(manifest, saveDocument) {
        const document2 = requireLocalDocument();
        const originalXmp = await getDocumentXmp(document2);
        assertActiveDocument(document2);
        const originalSidecar = await readSidecarRaw(document2);
        return photoshop().core.executeAsModal(async function() {
          assertActiveDocument(document2);
          let saveAttempted = false;
          try {
            const result = await writeManifestInCurrentModal(manifest, false);
            if (saveDocument !== false) {
              assertActiveDocument(document2);
              saveAttempted = true;
              await document2.save();
            }
            return result;
          } catch (error) {
            const rollbackErrors = [];
            try {
              await setDocumentXmp(originalXmp, document2);
            } catch (rollbackError) {
              rollbackErrors.push("PSD XMP：" + (rollbackError.message || rollbackError));
            }
            try {
              await restoreSidecarRaw(originalSidecar);
            } catch (rollbackError) {
              rollbackErrors.push("同目录配置镜像：" + (rollbackError.message || rollbackError));
            }
            if (saveAttempted) {
              try {
                await document2.save();
              } catch (rollbackError) {
                rollbackErrors.push("PSD 保存：" + (rollbackError.message || rollbackError));
              }
            }
            try {
              if (await getDocumentXmp(document2) !== originalXmp) throw new Error("原始 XMP 字节不一致。");
              const restoredSidecar = await readSidecarRaw(document2);
              if (restoredSidecar.exists !== originalSidecar.exists || restoredSidecar.serialized !== originalSidecar.serialized) {
                throw new Error("原始同目录配置镜像不一致。");
              }
            } catch (rollbackError) {
              rollbackErrors.push("回滚读回：" + (rollbackError.message || rollbackError));
            }
            if (rollbackErrors.length) {
              throw new Error((error.message || error) + "\nManifest 回滚失败：" + rollbackErrors.join("；"));
            }
            throw error;
          }
        }, { commandName: "PSD2UI：保存文档配置与同目录镜像" });
      }
      module.exports = {
        NamespaceUri,
        getSidecarPath,
        getDocumentXmp,
        setDocumentXmp,
        readManifest,
        readSidecarManifest,
        readSidecarRaw,
        restoreSidecarRaw,
        writeManifest,
        writeManifestInCurrentModal
      };
    }
  });

  // Plus-ins/PSD2UI/src/textEffects.js
  var require_textEffects = __commonJS({
    "Plus-ins/PSD2UI/src/textEffects.js"(exports, module) {
      "use strict";
      function number(value, fallback) {
        if (value == null) return fallback;
        const candidate = value && typeof value === "object" && value._value != null ? Number(value._value) : Number(value);
        return Number.isFinite(candidate) ? candidate : fallback;
      }
      function clamp01(value) {
        return Math.max(0, Math.min(1, value));
      }
      function color(value, opacityPercent) {
        if (!value) return null;
        const red = number(value.red, NaN);
        const green = number(value.green != null ? value.green : value.grain, NaN);
        const blue = number(value.blue, NaN);
        if (![red, green, blue].every(Number.isFinite)) return null;
        return {
          r: clamp01(red / 255),
          g: clamp01(green / 255),
          b: clamp01(blue / 255),
          a: clamp01(number(opacityPercent, 100) / 100)
        };
      }
      function effectEnabled(value) {
        return Boolean(value) && value.enabled !== false && value.present !== false;
      }
      function firstEnabled(effects, name) {
        const direct = effects && effects[name];
        if (Array.isArray(direct)) return direct.find(effectEnabled) || null;
        if (effectEnabled(direct)) return direct;
        const multi = effects && effects["".concat(name, "Multi")];
        return Array.isArray(multi) ? multi.find(effectEnabled) || null : null;
      }
      function normalizedTime(value) {
        return clamp01(number(value, 0) / 4096);
      }
      function normalizeGradient(effect) {
        if (!effect) return null;
        const gradient = effect.gradient || {};
        const opacity = number(effect.opacity, 100) / 100;
        const colorKeys = (gradient.colors || []).map((entry) => ({
          time: normalizedTime(entry.location),
          color: color(entry.color, 100)
        })).filter((entry) => entry.color).sort((left, right) => left.time - right.time);
        if (colorKeys.length < 2) return null;
        let alphaKeys = (gradient.transparency || []).map((entry) => ({
          time: normalizedTime(entry.location),
          alpha: clamp01(number(entry.opacity, 100) / 100 * opacity)
        })).sort((left, right) => left.time - right.time);
        if (alphaKeys.length < 2) {
          alphaKeys = [
            { time: 0, alpha: clamp01(opacity) },
            { time: 1, alpha: clamp01(opacity) }
          ];
        }
        const angle = number(effect.angle, 90) * Math.PI / 180;
        return {
          isVertical: Math.abs(Math.sin(angle)) >= Math.abs(Math.cos(angle)),
          colorKeys,
          alphaKeys
        };
      }
      function normalizeOutline(effect) {
        if (!effect) return null;
        const effectColor = color(effect.color, number(effect.opacity, 100));
        if (!effectColor) return null;
        const size = Math.max(0, number(effect.size, 0));
        return { color: effectColor, distanceX: size, distanceY: size };
      }
      function normalizeShadow(effect, globalAngle) {
        if (!effect) return null;
        const effectColor = color(effect.color, number(effect.opacity, 100));
        if (!effectColor) return null;
        const distance = Math.max(0, number(effect.distance, 0));
        const angle = number(effect.useGlobalAngle && globalAngle != null ? globalAngle : effect.localLightingAngle != null ? effect.localLightingAngle : effect.angle, 90) * Math.PI / 180;
        return {
          color: effectColor,
          distanceX: -Math.cos(angle) * distance,
          distanceY: -Math.sin(angle) * distance
        };
      }
      function normalizeLayerTextEffects(layerEffects, context = {}) {
        if (context.layerFXVisible === false) return null;
        if (!layerEffects || typeof layerEffects !== "object") return null;
        const result = {
          gradient: normalizeGradient(firstEnabled(layerEffects, "gradientFill")),
          outline: normalizeOutline(firstEnabled(layerEffects, "frameFX")),
          shadow: normalizeShadow(firstEnabled(layerEffects, "dropShadow"), context.globalAngle)
        };
        return result.gradient || result.outline || result.shadow ? result : null;
      }
      module.exports = { normalizeLayerTextEffects };
    }
  });

  // Plus-ins/PSD2UI-CEP/src/uxp.js
  var require_uxp = __commonJS({
    "Plus-ins/PSD2UI-CEP/src/uxp.js"(exports, module) {
      "use strict";
      module.exports = { storage: require_storage() };
    }
  });

  // Plus-ins/PSD2UI/src/photoshopDocument.js
  var require_photoshopDocument = __commonJS({
    "Plus-ins/PSD2UI/src/photoshopDocument.js"(exports, module) {
      "use strict";
      var { app, core, action, constants } = require_photoshop();
      var { normalizeLayerTextEffects } = require_textEffects();
      function asNumber(value) {
        if (value && typeof value === "object" && value.value != null) {
          return Number(value.value);
        }
        return Number(value);
      }
      function requireDocument() {
        const document2 = app.activeDocument;
        if (!document2) {
          throw new Error("当前没有打开的 Photoshop 文档。");
        }
        if (!document2.path || /^cloud:/i.test(String(document2.path))) {
          throw new Error("PSD2UI 第一版要求先把 PSD 保存为本地文件。");
        }
        return document2;
      }
      function normalizeNativePath(value) {
        return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
      }
      function toFileUrl(nativePath) {
        const normalized = String(nativePath || "").replace(/\\/g, "/");
        return /^[a-z]:\//i.test(normalized) ? "file:/".concat(normalized) : "file:".concat(normalized);
      }
      async function openLocalDocument(nativePath) {
        const requestedPath = String(nativePath || "").trim();
        if (!requestedPath) throw new Error("打开 Photoshop 文档时必须提供本地路径。");
        const normalizedRequestedPath = normalizeNativePath(requestedPath);
        const existing = Array.from(app.documents || []).find((document2) => normalizeNativePath(document2.path) === normalizedRequestedPath);
        if (existing) {
          if (!app.activeDocument || String(app.activeDocument.id) !== String(existing.id)) {
            await core.executeAsModal(() => {
              app.activeDocument = existing;
            }, { commandName: "PSD2UI：激活目标 PSD" });
          }
          return getDocumentInfo();
        }
        const file = await require_uxp().storage.localFileSystem.getEntryWithUrl(toFileUrl(requestedPath));
        const opened = await core.executeAsModal(async () => {
          const document2 = await app.open(file);
          if (document2) app.activeDocument = document2;
          return document2;
        }, { commandName: "PSD2UI：打开目标 PSD" });
        const info = getDocumentInfo();
        if (normalizeNativePath(info.path) !== normalizedRequestedPath) {
          throw new Error("Photoshop 打开的文档路径不符：".concat(info.path));
        }
        return info;
      }
      function layerKind(layer) {
        const value = String(layer && layer.kind || "").toLowerCase();
        if (value.includes("text")) return "text";
        if (value.includes("group") || layer && layer.layers && layer.layers.length > 0) return "group";
        return value || "pixel";
      }
      function readBounds(layer) {
        const bounds = layer.bounds;
        if (!bounds) {
          throw new Error("无法读取图层 '".concat(layer.name, "' 的 bounds。"));
        }
        return {
          left: asNumber(bounds.left),
          top: asNumber(bounds.top),
          right: asNumber(bounds.right),
          bottom: asNumber(bounds.bottom)
        };
      }
      function readAuthoringBounds(layer, layoutMode) {
        if (layoutMode === "point" && layer.boundsNoEffects) {
          const raw = layer.boundsNoEffects;
          const candidate = { left: asNumber(raw.left), top: asNumber(raw.top), right: asNumber(raw.right), bottom: asNumber(raw.bottom) };
          if (Object.values(candidate).every(Number.isFinite)) return candidate;
        }
        return readBounds(layer);
      }
      function mapTextAlignment(value) {
        const raw = String(value || "").toLowerCase();
        const horizontal = raw.includes("right") ? "right" : raw.includes("center") ? "center" : "left";
        return "middle-".concat(horizontal);
      }
      function readLayerPropertyDescriptor(layer, property) {
        if (!action || typeof action.batchPlay !== "function") return null;
        try {
          const document2 = requireDocument();
          const result = action.batchPlay([{
            _obj: "get",
            _target: {
              _ref: [
                { _property: property },
                { _ref: "layer", _id: Number(layer.id) },
                { _ref: "document", _id: document2.id }
              ]
            }
          }], { synchronousExecution: true });
          const descriptor = result && result[0];
          return descriptor && descriptor._obj !== "error" ? descriptor[property] || null : null;
        } catch (error) {
          return null;
        }
      }
      function readFullLayerDescriptor(layer) {
        if (!action || typeof action.batchPlay !== "function") return {};
        try {
          const result = action.batchPlay([{ _obj: "get", _target: { _ref: [
            { _ref: "layer", _id: Number(layer.id) },
            { _ref: "document", _id: requireDocument().id }
          ] } }], { synchronousExecution: true });
          return result && result[0] && result[0]._obj !== "error" ? result[0] : {};
        } catch (error) {
          return {};
        }
      }
      function descriptorPixels(value, resolution) {
        if (!value || typeof value !== "object" || !Number.isFinite(Number(value._value))) return NaN;
        if (value._unit === "pixelsUnit") return Number(value._value);
        if (value._unit === "pointsUnit") return Number(value._value) * resolution / 72;
        return NaN;
      }
      function readTextMetrics(characterStyle, textDescriptor) {
        const firstRange = textDescriptor && Array.isArray(textDescriptor.textStyleRange) && textDescriptor.textStyleRange.find((range) => range && range.textStyle);
        const sourceStyle = firstRange && firstRange.textStyle || {};
        const resolutionValue = asNumber(requireDocument().resolution);
        const resolution = Number.isFinite(resolutionValue) && resolutionValue > 0 ? resolutionValue : 72;
        const size = asNumber(characterStyle.size);
        const leading = asNumber(characterStyle.leading);
        const impliedSize = descriptorPixels(sourceStyle.impliedFontSize, resolution);
        const impliedLeading = descriptorPixels(sourceStyle.impliedLeading, resolution);
        const effectiveSize = Number.isFinite(impliedSize) && impliedSize > 0 ? impliedSize : size;
        const paragraph = textDescriptor && (textDescriptor.paragraphStyleRange || []).find((range) => range.paragraphStyle);
        const autoPercent = Number(paragraph && paragraph.paragraphStyle.autoLeading);
        const autoRatio = Number.isFinite(autoPercent) && autoPercent > 0 ? autoPercent / 100 : 1.2;
        const explicitLeading = Number.isFinite(impliedLeading) && impliedLeading > 0 ? impliedLeading : leading;
        const lineAdvance = sourceStyle.autoLeading === true || !(explicitLeading > 0) ? effectiveSize * autoRatio : explicitLeading;
        const lineSpacing = effectiveSize > 0 && lineAdvance > 0 ? lineAdvance / effectiveSize : 1.2;
        return __spreadValues({
          fontSize: Number.isFinite(effectiveSize) && effectiveSize > 0 ? Math.max(1, Math.round(effectiveSize)) : 24,
          lineSpacing: Math.max(0.1, lineSpacing)
        }, Number.isFinite(lineAdvance) && lineAdvance > 0 ? { lineAdvance } : {});
      }
      function readTextLayoutMode(layer, textDescriptor) {
        try {
          const point = layer.textItem.isPointText;
          if (typeof point === "boolean") return point ? "point" : "paragraph";
        } catch (error) {
        }
        try {
          const paragraph = layer.textItem.isParagraphText;
          if (typeof paragraph === "boolean") return paragraph ? "paragraph" : "point";
        } catch (error) {
        }
        const shapes = textDescriptor && textDescriptor.textShape;
        if (Array.isArray(shapes) && shapes.length > 0 && shapes.every((shape) => shape && shape.char && shape.char._enum === "char" && shape.char._value === "paint")) return "point";
        return void 0;
      }
      function readText(layer, layerEffects, textDescriptor, descriptor = {}) {
        if (layerKind(layer) !== "text") return null;
        const layoutMode = readTextLayoutMode(layer, textDescriptor);
        try {
          const textItem = layer.textItem;
          const characterStyle = textItem.characterStyle || {};
          const paragraphStyle = textItem.paragraphStyle || {};
          const solidColor = characterStyle.color;
          const rgb = solidColor && solidColor.rgb;
          const color = rgb ? {
            r: Math.max(0, Math.min(1, Number(rgb.red) / 255)),
            g: Math.max(0, Math.min(1, Number(rgb.green) / 255)),
            b: Math.max(0, Math.min(1, Number(rgb.blue) / 255)),
            a: 1
          } : null;
          const metrics = readTextMetrics({ size: characterStyle.size || textItem.fontSize, leading: characterStyle.leading }, textDescriptor);
          return __spreadProps(__spreadValues(__spreadValues({
            value: String(textItem.contents || "").replace(/\r\n?/g, "\n"),
            fontSize: metrics.fontSize,
            alignment: mapTextAlignment(paragraphStyle.justification),
            lineSpacing: metrics.lineSpacing
          }, metrics.lineAdvance > 0 ? { lineAdvance: metrics.lineAdvance } : {}), layoutMode ? { layoutMode } : {}), {
            color,
            effects: normalizeLayerTextEffects(layerEffects, descriptor)
          });
        } catch (error) {
          return __spreadProps(__spreadValues({
            value: String(layer.name || ""),
            fontSize: readTextMetrics({}, textDescriptor).fontSize,
            alignment: "middle-center",
            lineSpacing: readTextMetrics({}, textDescriptor).lineSpacing
          }, layoutMode ? { layoutMode } : {}), {
            color: null,
            effects: normalizeLayerTextEffects(layerEffects, descriptor)
          });
        }
      }
      function readStyleSignature(layer) {
        let boundsNoEffects = null;
        try {
          const value = layer.boundsNoEffects;
          if (value) {
            boundsNoEffects = {
              left: asNumber(value.left),
              top: asNumber(value.top),
              right: asNumber(value.right),
              bottom: asNumber(value.bottom)
            };
          }
        } catch (error) {
          boundsNoEffects = null;
        }
        return JSON.stringify({
          blendMode: String(layer.blendMode || ""),
          boundsNoEffects
        });
      }
      function readLayer(layer) {
        const children = [];
        const layers = layer.layers || [];
        for (let index = 0; index < layers.length; index += 1) {
          children.push(readLayer(layers[index]));
        }
        const opacity = Number(layer.opacity);
        const isText = layerKind(layer) === "text";
        const descriptor = readFullLayerDescriptor(layer);
        const effectsDescriptor = isText ? descriptor.layerEffects || null : null;
        const textDescriptor = descriptor.textKey || null;
        const text = readText(layer, effectsDescriptor, textDescriptor, descriptor);
        if (text) {
          const source = __spreadProps(__spreadValues({}, descriptor), { version: 1, layerEffects: effectsDescriptor });
          delete source.textKey;
          text.photoshop = { version: 1, descriptorJson: JSON.stringify(source) };
        }
        const bounds = readAuthoringBounds(layer, text && text.layoutMode);
        const textSource = textDescriptor ? {
          transform: textDescriptor.transform || null,
          styles: (textDescriptor.textStyleRange || []).map((range) => ({
            from: range.from,
            to: range.to,
            fontPostScriptName: range.textStyle && range.textStyle.fontPostScriptName,
            fontAvailable: range.textStyle && range.textStyle.fontAvailable,
            size: range.textStyle && range.textStyle.size,
            impliedFontSize: range.textStyle && range.textStyle.impliedFontSize
          }))
        } : null;
        return {
          layerId: String(layer.id),
          parentId: layer.parent && layer.parent.id != null ? String(layer.parent.id) : "",
          name: String(layer.name || "Layer-".concat(layer.id)),
          kind: layerKind(layer),
          bounds,
          visible: layer.visible !== false,
          opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity / 100)) : 1,
          rotationClockwiseDegrees: 0,
          text,
          protection: readLayerProtection(layer, descriptor),
          styleSignature: JSON.stringify({ base: readStyleSignature(layer), effects: effectsDescriptor, textSource }),
          children
        };
      }
      function findLayerById(layers, layerId) {
        for (let index = 0; index < layers.length; index += 1) {
          const layer = layers[index];
          if (String(layer.id) === String(layerId)) return layer;
          const found = findLayerById(layer.layers || [], layerId);
          if (found) return found;
        }
        return null;
      }
      function flattenLayers(layers, output) {
        for (let index = 0; index < layers.length; index += 1) {
          output.push(layers[index]);
          flattenLayers(layers[index].layers || [], output);
        }
      }
      function getActiveLayersInfo() {
        const document2 = requireDocument();
        const selectedIds = new Set((document2.activeLayers || []).map((layer) => String(layer.id)));
        if (selectedIds.size === 0) {
          throw new Error("请先选择一个或多个 Photoshop 图层。");
        }
        const orderedLayers = [];
        flattenLayers(document2.layers || [], orderedLayers);
        return orderedLayers.filter((layer) => selectedIds.has(String(layer.id))).map((layer) => {
          const snapshot = readLayer(layer);
          return __spreadProps(__spreadValues({}, snapshot), {
            id: snapshot.layerId,
            layer
          });
        });
      }
      function getActiveLayerInfo() {
        return getActiveLayersInfo()[0];
      }
      function createSnapshot(rootLayerId) {
        const document2 = requireDocument();
        if (String(rootLayerId) === "document-root") {
          const rootId = "document-root";
          const children = Array.from(document2.layers || []).map(readLayer).map((layer) => __spreadProps(__spreadValues({}, layer), { parentId: rootId }));
          return { root: {
            layerId: rootId,
            parentId: "",
            name: getDocumentInfo().name,
            kind: "group",
            documentRoot: true,
            bounds: { left: 0, top: 0, right: asNumber(document2.width), bottom: asNumber(document2.height) },
            visible: true,
            opacity: 1,
            rotationClockwiseDegrees: 0,
            text: null,
            styleSignature: "",
            children
          } };
        }
        const rootLayer = findLayerById(document2.layers || [], rootLayerId);
        if (!rootLayer) {
          throw new Error("当前 PSD 中找不到根图层 ".concat(rootLayerId, "。"));
        }
        return { root: readLayer(rootLayer) };
      }
      function getDocumentInfo() {
        const document2 = requireDocument();
        return {
          name: String(document2.title || "UI").replace(/\.psd$/i, ""),
          path: String(document2.path),
          width: asNumber(document2.width),
          height: asNumber(document2.height)
        };
      }
      async function addSelectionChangeListener(callback) {
        if (!action || typeof action.addNotificationListener !== "function") {
          throw new Error("当前 Photoshop 版本不支持图层选择事件监听，请使用“刷新当前状态”。");
        }
        if (typeof callback !== "function") {
          throw new TypeError("图层选择事件必须提供刷新回调。");
        }
        const notificationEvents = ["select", "open", "close"];
        const listener = (eventName, descriptor) => {
          if (!notificationEvents.includes(String(eventName || "").toLowerCase())) return;
          Promise.resolve(callback({ eventName, descriptor })).catch((error) => {
            console.error("Photoshop 图层选择变化后的 PSD2UI 刷新失败。", error);
          });
        };
        await action.addNotificationListener(notificationEvents, listener);
        return async () => {
          if (typeof action.removeNotificationListener === "function") {
            await action.removeNotificationListener(notificationEvents, listener);
          }
        };
      }
      function readLayerProtection(layer, sourceDescriptor) {
        const descriptor = sourceDescriptor || readFullLayerDescriptor(layer);
        const opacity = Number(layer.opacity);
        return {
          clipped: layer.clipped === true || layer.isClippingMask === true || descriptor.group === true,
          hasLayerMask: layer.hasLayerMask === true || descriptor.hasUserMask === true,
          hasVectorMask: layer.hasVectorMask === true || descriptor.hasVectorMask === true,
          opacity: Number.isFinite(opacity) ? opacity : 100,
          blendMode: String(layer.blendMode || "")
        };
      }
      function validateGroupSelection(selected, minimum = 2) {
        const document2 = requireDocument();
        if (!Array.isArray(selected) || selected.length < minimum) {
          throw new Error("组合为组件要求至少选择两个同级图层。");
        }
        const parent = selected[0].layer.parent || document2;
        const parentId = String(parent.id || "");
        if (selected.some((entry) => String((entry.layer.parent || document2).id || "") !== parentId)) {
          const error = new Error("所选图层不在同一父组，无法保持原有层级组合。请只选择同一组内的图层。");
          error.layerIds = selected.map((entry) => String(entry.id));
          throw error;
        }
        const siblings = Array.from(parent.layers || document2.layers || []);
        const selectedIds = new Set(selected.map((entry) => String(entry.id)));
        const indices = siblings.map((layer, index) => selectedIds.has(String(layer.id)) ? index : -1).filter((index) => index >= 0);
        if (indices.length !== selectedIds.size) throw new Error("所选图层已经发生变化，请刷新后重试。");
        const between = siblings.slice(indices[0], indices[indices.length - 1] + 1);
        const gaps = between.filter((layer) => !selectedIds.has(String(layer.id)));
        if (gaps.length) {
          const error = new Error("所选图层之间夹有未选图层：".concat(gaps.map((layer) => layer.name).join("、"), "。") + "组合会改变它们的叠放关系，请选择连续图层；可点击“定位问题图层”。");
          error.layerIds = gaps.map((layer) => String(layer.id));
          throw error;
        }
        const last = between[between.length - 1];
        const above = siblings[indices[0] - 1];
        if (readLayerProtection(last).clipped || above && readLayerProtection(above).clipped) {
          throw new Error("组合会切断剪贴蒙版链；请把基底与关联剪贴层一起包含在计划中。");
        }
        return { parent, parentId, siblings, layers: between };
      }
      async function selectLayersById(layerIds) {
        const document2 = requireDocument();
        const ids = Array.from(new Set((layerIds || []).map(String)));
        if (!ids.length) throw new Error("没有可定位的图层。");
        ids.forEach((id) => {
          if (!findLayerById(document2.layers || [], id)) throw new Error("问题图层 ".concat(id, " 已不存在，请重新检查。"));
        });
        await core.executeAsModal(async () => {
          for (let index = 0; index < ids.length; index += 1) {
            await action.batchPlay([__spreadProps(__spreadValues({
              _obj: "select",
              _target: [{ _ref: "layer", _id: Number(ids[index]) }]
            }, index > 0 ? { selectionModifier: { _enum: "selectionModifierType", _value: "addToSelection" } } : {}), {
              makeVisible: false,
              _options: { dialogOptions: "dontDisplay" }
            })], {});
          }
        }, { commandName: "PSD2UI：定位图层" });
        return { layerIds: ids };
      }
      var visualStatePreview = null;
      async function restoreVisualStatePreview() {
        if (!visualStatePreview) return { restored: false };
        const preview = visualStatePreview;
        const target = Array.from(app.documents || []).find((document2) => String(document2.id) === preview.documentId) || (app.activeDocument && String(app.activeDocument.id) === preview.documentId ? app.activeDocument : null);
        if (!target) throw new Error("状态预览的源 PSD 已关闭，无法恢复原可见性。");
        await core.executeAsModal(async () => {
          preview.layers.forEach((entry) => {
            const layer = findLayerById(target.layers || [], entry.layerId);
            if (!layer) throw new Error("预览图层 ".concat(entry.layerId, " 已删除，无法恢复。"));
            layer.visible = entry.visible;
          });
        }, { commandName: "PSD2UI：恢复状态预览" });
        visualStatePreview = null;
        return { restored: true };
      }
      async function previewVisualState(visualStates, stateName) {
        await restoreVisualStatePreview();
        const document2 = requireDocument();
        const states = visualStates && visualStates.states || [];
        if (!states.some((state) => state.name === stateName)) throw new Error("请选择需要预览的状态。");
        const targets = states.map((state) => {
          const layer = findLayerById(document2.layers || [], state.layerId);
          if (!layer || layerKind(layer) !== "group") throw new Error("状态组 ".concat(state.layerId, " 已不存在。"));
          return { name: state.name, layer };
        });
        const previous = { documentId: String(document2.id), layers: targets.map((entry) => ({
          layerId: String(entry.layer.id),
          visible: entry.layer.visible !== false
        })) };
        await core.executeAsModal(async () => {
          try {
            targets.forEach((entry) => {
              entry.layer.visible = entry.name === stateName;
            });
            visualStatePreview = previous;
          } catch (error) {
            previous.layers.forEach((entry) => {
              const layer = findLayerById(document2.layers || [], entry.layerId);
              if (layer) layer.visible = entry.visible;
            });
            throw error;
          }
        }, { commandName: "PSD2UI：预览组件状态" });
        return { state: stateName, temporary: true };
      }
      async function structureActiveLayers(plan, persist) {
        if (typeof persist !== "function") {
          throw new TypeError("结构化必须提供 Manifest 同步回调。");
        }
        const document2 = requireDocument();
        const selected = getActiveLayersInfo();
        const selection = validateGroupSelection(selected);
        const layers = selection.layers;
        const expectedIds = (plan.sourceLayerIds || layers.map((layer) => String(layer.id))).map(String);
        if (expectedIds.length !== layers.length || expectedIds.some((id, index) => id !== String(layers[index].id))) {
          throw new Error("组件配置期间选择已变化，请重新选择并确认角色。");
        }
        const beforeIds = selection.siblings.map((layer) => String(layer.id));
        const beforeBounds = layers.map((layer) => ({ id: String(layer.id), bounds: readBounds(layer) }));
        return core.executeAsModal(async (executionContext) => {
          const freshSelection = validateGroupSelection(getActiveLayersInfo());
          if (String(requireDocument().id) !== String(document2.id) || freshSelection.layers.length !== expectedIds.length || freshSelection.layers.some((layer, index) => String(layer.id) !== expectedIds[index])) {
            throw new Error("等待 Photoshop 执行期间选择已变化，请重新选择并确认角色。");
          }
          const suspension = await executionContext.hostControl.suspendHistory({
            documentID: document2.id,
            name: "PSD2UI：结构化为".concat(plan.groupName)
          });
          try {
            const group = await document2.createLayerGroup({
              name: plan.groupName,
              fromLayers: layers
            });
            if (!group) throw new Error("Photoshop 未能创建“".concat(plan.groupName, "”组。"));
            if (constants && constants.BlendMode && constants.BlendMode.PASSTHROUGH != null) {
              group.blendMode = constants.BlendMode.PASSTHROUGH;
            }
            const childIds = Array.from(group.layers || []).map((layer) => String(layer.id));
            if (childIds.length !== expectedIds.length || childIds.some((id, index) => id !== expectedIds[index])) {
              throw new Error("Photoshop 组合后的图层叠放顺序与原选择不一致，已回滚。");
            }
            const afterIds = Array.from(selection.parent.layers || document2.layers || []).flatMap((layer) => String(layer.id) === String(group.id) ? childIds : [String(layer.id)]);
            if (afterIds.length !== beforeIds.length || afterIds.some((id, index) => id !== beforeIds[index])) {
              throw new Error("组合改变了未选图层的叠放关系，已回滚。");
            }
            beforeBounds.forEach((entry) => {
              const live = findLayerById(group.layers || [], entry.id);
              if (!live) throw new Error("组合后图层 ".concat(entry.id, " 缺失，已回滚。"));
              const bounds = readBounds(live);
              if (Object.keys(entry.bounds).some((key) => Math.abs(bounds[key] - entry.bounds[key]) > 0.01)) {
                throw new Error("组合改变了图层 ".concat(live.name, " 的位置或尺寸，已回滚。"));
              }
            });
            const value = await persist({
              id: String(group.id),
              name: String(group.name || plan.groupName),
              layer: group
            });
            await executionContext.hostControl.resumeHistory(suspension, true);
            return value;
          } catch (error) {
            await executionContext.hostControl.resumeHistory(suspension, false);
            throw error;
          }
        }, { commandName: "PSD2UI：结构化为".concat(plan.groupName) });
      }
      async function renameActiveLayers(renames, persist) {
        if (typeof persist !== "function") {
          throw new TypeError("批量重命名必须提供 Manifest 同步回调。");
        }
        const document2 = requireDocument();
        const selected = getActiveLayersInfo();
        const entries = Array.isArray(renames) ? renames : [];
        if (entries.length !== selected.length) {
          throw new Error("批量改名计划数量 ".concat(entries.length, " 与当前选择数量 ").concat(selected.length, " 不一致。"));
        }
        const selectedById = new Map(selected.map((entry) => [String(entry.id), entry]));
        const plannedLayerIds = /* @__PURE__ */ new Set();
        const targetNames = /* @__PURE__ */ new Set();
        const resolved = entries.map((entry, index) => {
          const layerId = String(entry && entry.layerId || "");
          const selectedLayer = selectedById.get(layerId);
          if (!selectedLayer) throw new Error("批量改名第 ".concat(index + 1, " 项不是当前选中图层：").concat(layerId || "<empty>", "。"));
          if (plannedLayerIds.has(layerId)) throw new Error("批量改名计划重复包含图层 ".concat(layerId, "。"));
          plannedLayerIds.add(layerId);
          if (entry.previousName != null && String(entry.previousName) !== selectedLayer.name) {
            throw new Error("图层 ".concat(layerId, " 名称已变化：期望 '").concat(entry.previousName, "'，实际 '").concat(selectedLayer.name, "'。"));
          }
          const name = String(entry.name || "").trim();
          if (!isEnglishIdentifier(name)) {
            throw new Error("批量改名结果不是有效英文标识符：".concat(layerId, ":").concat(name || "<empty>", "。"));
          }
          if (targetNames.has(name)) throw new Error("批量改名结果重复：".concat(name, "。"));
          targetNames.add(name);
          return { layerId, previousName: selectedLayer.name, name, layer: selectedLayer.layer };
        });
        const selectedIds = new Set(resolved.map((entry) => entry.layerId));
        const allLayers = [];
        flattenLayers(document2.layers || [], allLayers);
        const occupiedNames = new Set(allLayers.filter((layer) => !selectedIds.has(String(layer.id))).map((layer) => String(layer.name || "")));
        const conflict = resolved.find((entry) => occupiedNames.has(entry.name));
        if (conflict) {
          throw new Error("批量改名结果 '".concat(conflict.name, "' 已被未选中的 Photoshop 图层使用。"));
        }
        return core.executeAsModal(async (executionContext) => {
          const suspension = await executionContext.hostControl.suspendHistory({
            documentID: document2.id,
            name: "PSD2UI：批量重命名 ".concat(resolved.length, " 个图层")
          });
          try {
            resolved.forEach((entry) => {
              entry.layer.name = entry.name;
            });
            const renamed = resolved.map((entry) => ({
              layerId: entry.layerId,
              previousName: entry.previousName,
              name: String(entry.layer.name || entry.name)
            }));
            const value = await persist(renamed);
            await executionContext.hostControl.resumeHistory(suspension, true);
            return { renamed, value };
          } catch (error) {
            await executionContext.hostControl.resumeHistory(suspension, false);
            throw error;
          }
        }, { commandName: "PSD2UI：批量重命名 ".concat(resolved.length, " 个图层") });
      }
      function requirePlanArray(plan, name) {
        const value = plan && plan[name];
        if (value == null) return [];
        if (!Array.isArray(value)) throw new Error("结构计划字段 ".concat(name, " 必须是数组。"));
        return value;
      }
      function requirePlanText(value, label) {
        const result = String(value || "").trim();
        if (!result) throw new Error("".concat(label, " 不能为空。"));
        return result;
      }
      function normalizePlanRef(value, label) {
        return requirePlanText(value, label);
      }
      function isAliasRef(value) {
        return String(value || "").startsWith("@");
      }
      function assertBounds(layer, expected, label, actualBounds) {
        if (!expected) return;
        const actual = actualBounds || readBounds(layer);
        ["left", "top", "right", "bottom"].forEach((key) => {
          const target = Number(expected[key]);
          if (!Number.isFinite(target) || !Number.isFinite(actual[key]) || Math.abs(actual[key] - target) > 1) {
            throw new Error(
              "".concat(label, " 的 ").concat(key, " 前置条件不符：期望 ").concat(expected[key], "，实际 ").concat(actual[key], "。")
            );
          }
        });
      }
      function assertLayerPrecondition(document2, condition) {
        const layerId = requirePlanText(condition && condition.layerId, "图层前置条件 layerId");
        const layer = findLayerById(document2.layers || [], layerId);
        if (!layer) throw new Error("结构计划前置图层 ".concat(layerId, " 已不存在。"));
        if (condition.name != null && String(layer.name || "") !== String(condition.name)) {
          throw new Error(
            "图层 ".concat(layerId, " 名称前置条件不符：期望 '").concat(condition.name, "'，实际 '").concat(layer.name || "", "'。")
          );
        }
        if (condition.kind != null && layerKind(layer) !== String(condition.kind)) {
          throw new Error(
            "图层 ".concat(layerId, " 类型前置条件不符：期望 '").concat(condition.kind, "'，实际 '").concat(layerKind(layer), "'。")
          );
        }
        if (condition.parentId != null) {
          const actualParentId = layer.parent && layer.parent.id != null ? String(layer.parent.id) : "";
          const expectedParentId = String(condition.parentId) === "document-root" ? String(document2.id) : String(condition.parentId);
          if (actualParentId !== expectedParentId) {
            throw new Error(
              "图层 ".concat(layerId, " 父级前置条件不符：期望 '").concat(condition.parentId, "'，实际 '").concat(actualParentId, "'。")
            );
          }
        }
        if (condition.visible != null && layer.visible !== false !== Boolean(condition.visible)) {
          throw new Error("图层 ".concat(layerId, " 可见性前置条件不符。"));
        }
        if (condition.protection != null) {
          const actual = readLayerProtection(layer);
          const expected = condition.protection;
          if (!expected || typeof expected !== "object" || Array.isArray(expected) || Object.keys(actual).some((key) => !Object.prototype.hasOwnProperty.call(expected, key) || actual[key] !== expected[key])) {
            throw new Error("图层 ".concat(layerId, " 的蒙版、剪贴关系或混合设置已变化。"));
          }
        }
        if (condition.siblingIds != null) {
          if (!Array.isArray(condition.siblingIds)) throw new Error("图层 ".concat(layerId, " 的 siblingIds 必须是同级图层数组。"));
          const actual = Array.from((layer.parent || document2).layers || []).map((entry) => String(entry.id));
          if (JSON.stringify(actual) !== JSON.stringify(condition.siblingIds.map(String))) throw new Error("图层 ".concat(layerId, " 的同级叠放顺序已变化。"));
        }
        const layoutMode = condition.bounds && layerKind(layer) === "text" ? readTextLayoutMode(layer, readLayerPropertyDescriptor(layer, "textKey")) : void 0;
        assertBounds(layer, condition.bounds, "图层 ".concat(layerId), condition.bounds && readAuthoringBounds(layer, layoutMode));
        return layer;
      }
      function collectExistingPlanRefs(plan) {
        const refs = [];
        requirePlanArray(plan, "copies").forEach((entry) => refs.push(entry.sourceLayerId));
        requirePlanArray(plan, "renames").forEach((entry) => refs.push(entry.ref));
        requirePlanArray(plan, "containers").forEach((entry) => {
          (entry.members || []).forEach((ref) => refs.push(ref));
        });
        requirePlanArray(plan, "groups").forEach((entry) => {
          (entry.members || []).forEach((ref) => refs.push(ref));
          (entry.roles || []).forEach((role) => refs.push(role.ref));
          (entry.previewRefs || []).forEach((ref) => refs.push(ref));
        });
        requirePlanArray(plan, "adopt").forEach((entry) => {
          refs.push(entry.ref);
          (entry.roles || []).forEach((role) => refs.push(role.ref));
          (entry.previewRefs || []).forEach((ref) => refs.push(ref));
        });
        requirePlanArray(plan, "presets").forEach((entry) => refs.push(entry.ref));
        requirePlanArray(plan, "moves").forEach((entry) => {
          refs.push(entry.ref);
          if (entry.parentRef !== "document-root") refs.push(entry.parentRef);
          if (entry.beforeRef != null) refs.push(entry.beforeRef);
          if (entry.afterRef != null) refs.push(entry.afterRef);
        });
        ["ungroups", "deletes"].forEach((kind) => requirePlanArray(plan, kind).forEach((entry) => {
          refs.push(entry.ref);
          (entry.expectedDescendantIds || []).forEach((ref) => refs.push(ref));
        }));
        return refs.filter((ref) => ref != null && !isAliasRef(ref)).map((ref) => String(ref));
      }
      function validateConfirmedStructurePlan(document2, plan) {
        if (!plan || plan.version !== 1) throw new Error("结构计划必须使用 version=1。");
        requirePlanText(plan.confirmationId, "结构计划 confirmationId");
        ["moves", "ungroups", "deletes"].forEach((kind) => requirePlanArray(plan, kind).forEach((entry) => {
          if (entry.allowAppearanceChange !== true) throw new Error("".concat(kind, " 必须在已确认计划中显式声明 allowAppearanceChange:true。"));
          if (kind !== "moves" && !Array.isArray(entry.expectedDescendantIds)) throw new Error("".concat(kind, " 必须显式列出 expectedDescendantIds（叶层使用空数组）。"));
          if (kind === "moves" && entry.beforeRef != null && entry.afterRef != null) throw new Error("移动不能同时指定 beforeRef 和 afterRef。");
        }));
        const availableAliases = new Set(requirePlanArray(plan, "copies").map((entry) => String(entry.alias)));
        const componentAliases = new Set(requirePlanArray(plan, "groups").map((entry) => String(entry.alias)));
        requirePlanArray(plan, "containers").forEach((entry) => {
          const alias = normalizePlanRef(entry.alias, "容器组 alias");
          if (!isAliasRef(alias) || alias.length < 2) throw new Error("容器组 alias 必须以 @ 开头并包含名称：".concat(alias));
          if (availableAliases.has(alias) || componentAliases.has(alias)) throw new Error("结构计划 alias 重复：".concat(alias));
          requirePlanText(entry.name, "容器组名称");
          if (!Array.isArray(entry.members) || !entry.members.length) throw new Error("容器组 ".concat(alias, " 没有成员。"));
          const members = entry.members.map((ref) => normalizePlanRef(ref, "容器组成员"));
          if (new Set(members).size !== members.length) throw new Error("容器组 ".concat(alias, " 重复引用成员。"));
          members.filter(isAliasRef).forEach((ref) => {
            if (!availableAliases.has(ref)) throw new Error("容器组 ".concat(alias, " 引用了尚未建立的别名 ").concat(ref, "。"));
          });
          availableAliases.add(alias);
        });
        const preconditions = requirePlanArray(plan, "preconditions");
        if (preconditions.length === 0) throw new Error("结构计划必须提供完整图层前置条件。");
        const covered = /* @__PURE__ */ new Set();
        preconditions.forEach((condition) => {
          const layer = assertLayerPrecondition(document2, condition);
          const layerId = String(layer.id);
          if (covered.has(layerId)) throw new Error("结构计划重复声明图层 ".concat(layerId, " 的前置条件。"));
          covered.add(layerId);
        });
        const missing = Array.from(new Set(collectExistingPlanRefs(plan))).filter((layerId) => !covered.has(layerId));
        if (missing.length > 0) {
          throw new Error("结构计划缺少现有图层前置条件：".concat(missing.join(", "), "。"));
        }
      }
      function isEnglishIdentifier(value) {
        return /^[A-Za-z][A-Za-z0-9_]*$/.test(String(value || ""));
      }
      function collectSnapshotNameIssues(node, issues) {
        if (!node) return issues;
        if (!isEnglishIdentifier(node.name)) {
          issues.push("".concat(node.layerId, ":").concat(node.name || "<empty>"));
        }
        (node.children || []).forEach((child) => collectSnapshotNameIssues(child, issues));
        return issues;
      }
      function createPostRenameValidationPlan(plan, omitVisibility) {
        const renamedNames = new Map(requirePlanArray(plan, "renames").filter((entry) => !isAliasRef(entry.ref)).map((entry) => [String(entry.ref), String(entry.name)]));
        return __spreadProps(__spreadValues({}, plan), {
          preconditions: requirePlanArray(plan, "preconditions").map((condition) => {
            const resolved = __spreadProps(__spreadValues({}, condition), {
              name: renamedNames.has(String(condition.layerId)) ? renamedNames.get(String(condition.layerId)) : condition.name
            });
            if (omitVisibility) delete resolved.visible;
            return resolved;
          })
        });
      }
      async function applyConfirmedPreinitializeRenames(plan, rootLayerId, options) {
        const document2 = requireDocument();
        const repairPreservedState = Boolean(options && options.repairPreservedState);
        const resolvedRootLayerId = requirePlanText(rootLayerId, "初始化根图层 rootLayerId");
        if (!findLayerById(document2.layers || [], resolvedRootLayerId)) {
          throw new Error("当前 PSD 中找不到初始化根图层 ".concat(resolvedRootLayerId, "。"));
        }
        const postRenamePlan = createPostRenameValidationPlan(plan, false);
        validateConfirmedStructurePlan(
          document2,
          repairPreservedState ? createPostRenameValidationPlan(plan, true) : plan
        );
        return core.executeAsModal(async (executionContext) => {
          const suspension = await executionContext.hostControl.suspendHistory({
            documentID: document2.id,
            name: "PSD2UI：初始化前应用已确认命名 ".concat(plan.confirmationId)
          });
          try {
            const renamed = [];
            if (!repairPreservedState) {
              for (const entry of requirePlanArray(plan, "renames")) {
                if (isAliasRef(entry.ref)) continue;
                const layerId = normalizePlanRef(entry.ref, "初始化前重命名图层引用");
                const layer = findLayerById(document2.layers || [], layerId);
                if (!layer) throw new Error("初始化前重命名找不到图层 ".concat(layerId, "。"));
                const name = requirePlanText(entry.name, "初始化前重命名目标名称");
                if (!isEnglishIdentifier(name)) {
                  throw new Error("初始化前重命名目标不是有效英文标识符：".concat(layerId, ":").concat(name, "。"));
                }
                const previousName = String(layer.name || "");
                layer.name = name;
                renamed.push({ layerId, previousName, name: String(layer.name || name) });
              }
            }
            const visibilityRestored = [];
            for (const condition of requirePlanArray(plan, "preconditions")) {
              if (condition.visible == null) continue;
              const layer = findLayerById(document2.layers || [], String(condition.layerId));
              if (!layer) throw new Error("初始化前状态恢复找不到图层 ".concat(condition.layerId, "。"));
              const expected = Boolean(condition.visible);
              if (layer.visible !== false !== expected) {
                const previousVisible = layer.visible !== false;
                layer.visible = expected;
                visibilityRestored.push({
                  layerId: String(layer.id),
                  previousVisible,
                  visible: expected
                });
              }
            }
            validateConfirmedStructurePlan(document2, postRenamePlan);
            const issues = collectSnapshotNameIssues(createSnapshot(resolvedRootLayerId).root, []);
            if (issues.length > 0) {
              throw new Error(
                "初始化根组仍有 ".concat(issues.length, " 个非法图层名：").concat(issues.slice(0, 12).join(", ")) + (issues.length > 12 ? "，……" : "。")
              );
            }
            await document2.save();
            await executionContext.hostControl.resumeHistory(suspension, true);
            return {
              confirmationId: String(plan.confirmationId),
              rootLayerId: resolvedRootLayerId,
              mode: repairPreservedState ? "repair-preserved-state" : "preinitialize-rename",
              renamedCount: renamed.length,
              renamed,
              visibilityRestoredCount: visibilityRestored.length,
              visibilityRestored
            };
          } catch (error) {
            await executionContext.hostControl.resumeHistory(suspension, false);
            throw error;
          }
        }, { commandName: "PSD2UI：初始化前应用已确认命名 ".concat(plan.confirmationId) });
      }
      function isDescendantOrSelf(root, layer) {
        if (String(root.id) === String(layer.id)) return true;
        return Array.from(root.layers || []).some((child) => isDescendantOrSelf(child, layer));
      }
      function layerTreeKey(layer, document2) {
        return layer === document2 || typeof layer.save === "function" && String(layer.id) === String(document2.id) ? "document-root" : "layer:".concat(layer.id);
      }
      function captureLayerTreeOrders(document2) {
        const result = /* @__PURE__ */ new Map();
        const visit = (parent) => {
          const children = Array.from(parent.layers || []);
          const key = layerTreeKey(parent, document2);
          if (result.has(key)) throw new Error("图层树包含重复或循环引用。");
          result.set(key, children.map((child) => String(child.id)));
          children.forEach((child) => {
            if (layerTreeKey(child.parent || document2, document2) !== key) throw new Error("图层树的子层父级不符，已回滚。");
          });
          children.forEach(visit);
        };
        visit(document2);
        return result;
      }
      function assertLayerTreeOrders(document2, expected, label) {
        const actual = captureLayerTreeOrders(document2);
        if (actual.size !== expected.size || Array.from(expected).some(([key, ids]) => {
          const found = actual.get(key);
          return !found || found.length !== ids.length || found.some((id, index) => id !== ids[index]);
        })) throw new Error("".concat(label, " 后的图层、父级或叠放顺序不符，已回滚。"));
      }
      async function applyConfirmedStructurePlan(plan, persist) {
        const document2 = requireDocument();
        if (typeof persist !== "function") throw new TypeError("结构计划必须提供 Manifest 持久化回调。");
        validateConfirmedStructurePlan(document2, plan);
        return core.executeAsModal(async (executionContext) => {
          if (String(requireDocument().id) !== String(document2.id)) {
            throw new Error("等待 Photoshop 执行期间切换了 PSD，请重新确认结构计划。");
          }
          validateConfirmedStructurePlan(document2, plan);
          const suspension = await executionContext.hostControl.suspendHistory({
            documentID: document2.id,
            name: "PSD2UI：应用已确认结构计划 ".concat(plan.confirmationId)
          });
          try {
            const aliases = /* @__PURE__ */ new Map();
            const copies = [];
            const containers = [];
            const structured = [];
            const presets = [];
            const edits = [];
            const registerAlias = (rawAlias, layer) => {
              const alias = normalizePlanRef(rawAlias, "结构计划 alias");
              if (!isAliasRef(alias)) throw new Error("结构计划 alias 必须以 @ 开头：".concat(alias));
              if (aliases.has(alias)) throw new Error("结构计划 alias 重复：".concat(alias));
              aliases.set(alias, layer);
            };
            const resolveRef = (rawRef) => {
              const ref = normalizePlanRef(rawRef, "结构计划图层引用");
              const alias = isAliasRef(ref) ? aliases.get(ref) : null;
              const layer = findLayerById(document2.layers || [], alias ? String(alias.id) : ref);
              if (!layer) throw new Error("结构计划找不到图层引用 ".concat(ref, "。"));
              return layer;
            };
            const resolveRoles = (owner, entries) => (entries || []).map((entry) => {
              const target = resolveRef(entry.ref);
              if (!isDescendantOrSelf(owner, target) || String(owner.id) === String(target.id)) {
                throw new Error(
                  "结构角色 '".concat(entry.name || "", "' 指向的图层 ").concat(target.id, " 不在组件组 ").concat(owner.id, " 内。")
                );
              }
              return {
                name: requirePlanText(entry.name, "结构角色名称"),
                layerId: String(target.id),
                nodeId: null
              };
            });
            const makeStructure = (owner, entry) => {
              const structure = {
                version: 1,
                roles: resolveRoles(owner, entry.roles),
                previewLayerIds: (entry.previewRefs || []).map((ref) => {
                  const target = resolveRef(ref);
                  if (!isDescendantOrSelf(owner, target) || String(owner.id) === String(target.id)) {
                    throw new Error("预览图层 ".concat(target.id, " 不在组件组 ").concat(owner.id, " 内。"));
                  }
                  return String(target.id);
                })
              };
              if (entry.layout != null) {
                structure.layout = JSON.parse(JSON.stringify(entry.layout));
                structure.layoutSource = "explicit";
              }
              return structure;
            };
            for (const entry of requirePlanArray(plan, "copies")) {
              const source = resolveRef(entry.sourceLayerId);
              const copy = await source.duplicate();
              copy.name = requirePlanText(entry.name, "复制图层名称");
              const offsetX = Number(entry.offsetX || 0);
              const offsetY = Number(entry.offsetY || 0);
              if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
                throw new Error("复制图层 ".concat(entry.alias || "", " 的偏移必须是有限数字。"));
              }
              if (offsetX !== 0 || offsetY !== 0) await copy.translate(offsetX, offsetY);
              if (entry.visible != null) copy.visible = Boolean(entry.visible);
              assertBounds(copy, entry.expectedBounds, "复制图层 ".concat(entry.alias || copy.id));
              registerAlias(entry.alias, copy);
              copies.push({
                alias: String(entry.alias),
                layerId: String(copy.id),
                sourceLayerId: String(source.id)
              });
            }
            for (const entry of requirePlanArray(plan, "renames")) {
              const layer = resolveRef(entry.ref);
              layer.name = requirePlanText(entry.name, "重命名目标名称");
            }
            for (const entry of requirePlanArray(plan, "containers")) {
              const members = (entry.members || []).map(resolveRef);
              if (!members.length) throw new Error("容器组 ".concat(entry.alias || "", " 没有成员。"));
              const selectedIds = new Set(members.map((layer) => String(layer.id)));
              if (selectedIds.size !== members.length) throw new Error("容器组 ".concat(entry.alias || "", " 重复引用成员。"));
              const parent = members[0].parent || document2;
              if (members.some((layer) => String((layer.parent || document2).id) !== String(parent.id))) {
                throw new Error("容器组 ".concat(entry.alias || "", " 的成员不在同一父级。"));
              }
              validateGroupSelection(members.map((layer) => ({ id: layer.id, layer })), 1);
              const siblings = Array.from(parent.layers || []);
              const ordered = siblings.filter((layer) => selectedIds.has(String(layer.id)));
              const expectedIds = ordered.map((layer) => String(layer.id));
              const remainingIds = siblings.filter((layer) => !selectedIds.has(String(layer.id))).map((layer) => String(layer.id));
              const bounds = ordered.map((layer) => ({ layer, bounds: readBounds(layer) }));
              const group = await document2.createLayerGroup({
                name: requirePlanText(entry.name, "容器组名称"),
                fromLayers: ordered
              });
              if (!group) throw new Error("Photoshop 未能创建容器组 '".concat(entry.name || "", "'。"));
              if (constants && constants.BlendMode && constants.BlendMode.PASSTHROUGH != null) {
                group.blendMode = constants.BlendMode.PASSTHROUGH;
              }
              const actualIds = Array.from(group.layers || []).map((layer) => String(layer.id));
              if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
                throw new Error("容器组合后的图层叠放顺序不一致，已回滚。");
              }
              const actualRemainingIds = Array.from(parent.layers || []).filter((layer) => String(layer.id) !== String(group.id)).map((layer) => String(layer.id));
              if (actualRemainingIds.length !== remainingIds.length || actualRemainingIds.some((id, index) => id !== remainingIds[index])) {
                throw new Error("容器组合改变了未选图层的叠放关系，已回滚。");
              }
              bounds.forEach((entry2) => assertBounds(entry2.layer, entry2.bounds, "容器成员 ".concat(entry2.layer.id)));
              registerAlias(entry.alias, group);
              containers.push({
                alias: String(entry.alias),
                layerId: String(group.id),
                name: String(group.name),
                memberLayerIds: expectedIds
              });
            }
            for (const entry of requirePlanArray(plan, "groups")) {
              const members = (entry.members || []).map(resolveRef);
              if (members.length === 0) throw new Error("结构组 ".concat(entry.alias || "", " 没有成员。"));
              const memberIds = new Set(members.map((layer) => String(layer.id)));
              if (memberIds.size !== members.length) throw new Error("结构组 ".concat(entry.alias || "", " 重复引用成员。"));
              const parentIds = new Set(members.map((layer) => layer.parent && layer.parent.id != null ? String(layer.parent.id) : ""));
              if (parentIds.size !== 1) throw new Error("结构组 ".concat(entry.alias || "", " 的成员不在同一父级。"));
              const selection = validateGroupSelection(members.map((layer) => ({ id: layer.id, layer })), 1);
              const beforeIds = selection.siblings.map((layer) => String(layer.id));
              const beforeBounds = selection.layers.map((layer) => ({ layer, bounds: readBounds(layer) }));
              const group = await document2.createLayerGroup({
                name: requirePlanText(entry.name, "结构组名称"),
                fromLayers: selection.layers
              });
              if (!group) throw new Error("Photoshop 未能创建结构组 '".concat(entry.name || "", "'。"));
              group.blendMode = constants.BlendMode.PASSTHROUGH;
              const flattened = Array.from(selection.parent.layers || []).flatMap((layer) => String(layer.id) === String(group.id) ? Array.from(group.layers || []).map((child) => String(child.id)) : [String(layer.id)]);
              if (JSON.stringify(flattened) !== JSON.stringify(beforeIds)) throw new Error("组件组合改变了图层叠放顺序，已回滚。");
              beforeBounds.forEach((item) => assertBounds(item.layer, item.bounds, "组件成员 ".concat(item.layer.id)));
              registerAlias(entry.alias, group);
              structured.push({
                layerId: String(group.id),
                name: String(group.name || entry.name),
                semantic: requirePlanText(entry.semantic, "结构组语义"),
                structure: makeStructure(group, entry)
              });
            }
            for (const entry of requirePlanArray(plan, "moves")) {
              const layer = resolveRef(entry.ref);
              const layerId = String(layer.id);
              const parent = entry.parentRef === "document-root" ? document2 : resolveRef(entry.parentRef);
              if (parent !== document2 && (layerKind(parent) !== "group" || isDescendantOrSelf(layer, parent))) throw new Error("移动目标必须是不会产生循环引用的组。");
              const before = entry.beforeRef != null ? resolveRef(entry.beforeRef) : null;
              const after = entry.afterRef != null ? resolveRef(entry.afterRef) : null;
              if ([before, after].some((anchor) => anchor && (String(anchor.id) === layerId || layerTreeKey(anchor.parent || document2, document2) !== layerTreeKey(parent, document2)))) throw new Error("移动的排序参照必须是目标组内的其他图层。");
              const bounds = readBounds(layer);
              const descendants = [];
              flattenLayers(layer.layers || [], descendants);
              const descendantBounds = descendants.map((child) => ({ id: String(child.id), bounds: readBounds(child) }));
              const expectedTree = captureLayerTreeOrders(document2);
              const previousParentKey = layerTreeKey(layer.parent || document2, document2);
              const parentKey = layerTreeKey(parent, document2);
              expectedTree.set(previousParentKey, expectedTree.get(previousParentKey).filter((id) => id !== layerId));
              const targetOrder = expectedTree.get(parentKey).filter((id) => id !== layerId);
              const insertionIndex = before ? targetOrder.indexOf(String(before.id)) : after ? targetOrder.indexOf(String(after.id)) + 1 : 0;
              targetOrder.splice(insertionIndex, 0, layerId);
              expectedTree.set(parentKey, targetOrder);
              if (typeof layer.moveTo === "function") await layer.moveTo(parent, { beforeId: before && before.id, afterId: after && after.id });
              else if (typeof layer.move === "function") await layer.move(
                before || after || parent,
                before ? constants.ElementPlacement.PLACEBEFORE : after ? constants.ElementPlacement.PLACEAFTER : constants.ElementPlacement.PLACEATBEGINNING
              );
              else throw new Error("当前宿主未实现图层移动。");
              assertLayerTreeOrders(document2, expectedTree, "移动图层 ".concat(layerId));
              const moved = findLayerById(document2.layers || [], layerId);
              assertBounds(moved, entry.expectedBounds || bounds, "移动图层 ".concat(layerId));
              if (layerTreeKey(moved.parent || document2, document2) !== parentKey) throw new Error("移动后的父级不符，已回滚。");
              descendantBounds.forEach((child) => assertBounds(findLayerById(document2.layers || [], child.id), child.bounds, "移动子层 ".concat(child.id)));
              edits.push({ operation: "move", layerId, parentId: String(parent.id) });
            }
            for (const kind of ["ungroups", "deletes"]) for (const entry of requirePlanArray(plan, kind)) {
              const layer = resolveRef(entry.ref);
              const layerId = String(layer.id);
              const descendants = [];
              flattenLayers(layer.layers || [], descendants);
              const ids = descendants.map((child) => String(child.id));
              if (JSON.stringify(ids) !== JSON.stringify(entry.expectedDescendantIds.map(String))) throw new Error("".concat(kind, " 子层清单已变化，已停止操作。"));
              const parent = layer.parent || document2;
              const parentKey = layerTreeKey(parent, document2);
              const expectedTree = captureLayerTreeOrders(document2);
              const siblings = expectedTree.get(parentKey);
              const index = siblings.indexOf(layerId);
              const directChildren = expectedTree.get("layer:".concat(layerId));
              expectedTree.delete("layer:".concat(layerId));
              if (kind === "ungroups") {
                if (layerKind(layer) !== "group") throw new Error("拆组目标必须是组。");
                siblings.splice(index, 1, ...directChildren);
                const childBounds = descendants.map((child) => ({ id: String(child.id), bounds: readBounds(child) }));
                if (typeof layer.ungroup === "function") await layer.ungroup();
                else {
                  await action.batchPlay([{
                    _obj: "select",
                    _target: [{ _ref: "layer", _id: Number(layerId) }],
                    makeVisible: false,
                    _options: { dialogOptions: "dontDisplay" }
                  }], {});
                  await action.batchPlay([{ _obj: "ungroupLayersEvent", _options: { dialogOptions: "dontDisplay" } }], {});
                }
                assertLayerTreeOrders(document2, expectedTree, "拆组 ".concat(layerId));
                childBounds.forEach((child) => assertBounds(findLayerById(document2.layers || [], child.id), child.bounds, "拆组子层 ".concat(child.id)));
                directChildren.forEach((id) => {
                  const child = findLayerById(document2.layers || [], id);
                  if (layerTreeKey(child.parent || document2, document2) !== parentKey) throw new Error("拆组后子层父级不符，已回滚。");
                });
              } else {
                siblings.splice(index, 1);
                ids.forEach((id) => expectedTree.delete("layer:".concat(id)));
                if (typeof layer.delete !== "function") throw new Error("当前宿主未实现图层删除。");
                await layer.delete();
                assertLayerTreeOrders(document2, expectedTree, "删除图层 ".concat(layerId));
              }
              edits.push({ operation: kind === "ungroups" ? "ungroup" : "delete", layerId, descendantIds: ids });
            }
            for (const entry of requirePlanArray(plan, "adopt")) {
              const group = resolveRef(entry.ref);
              if (layerKind(group) !== "group") {
                throw new Error("现有组件根 ".concat(entry.ref || "", " 不是 Photoshop 组。"));
              }
              structured.push({
                layerId: String(group.id),
                name: String(entry.name || group.name || ""),
                semantic: requirePlanText(entry.semantic, "现有组件组语义"),
                structure: makeStructure(group, entry)
              });
            }
            for (const entry of requirePlanArray(plan, "presets")) {
              const layer = resolveRef(entry.ref);
              presets.push({
                layerId: String(layer.id),
                name: String(entry.name || layer.name || ""),
                semantic: requirePlanText(entry.semantic, "节点预设语义")
              });
            }
            const value = await persist({
              confirmationId: String(plan.confirmationId),
              copies,
              containers,
              structured,
              presets,
              edits
            });
            await executionContext.hostControl.resumeHistory(suspension, true);
            return value;
          } catch (error) {
            await executionContext.hostControl.resumeHistory(suspension, false);
            throw error;
          }
        }, { commandName: "PSD2UI：应用已确认结构计划 ".concat(plan.confirmationId) });
      }
      async function wrapTopLevelLayersInGroup(layerIds, groupName, persist) {
        const document2 = requireDocument();
        const requestedIds = Array.from(new Set((layerIds || []).map((value) => String(value))));
        const topLevelLayers = Array.from(document2.layers || []);
        const topLevelIds = topLevelLayers.map((layer) => String(layer.id));
        if (requestedIds.length !== topLevelIds.length || requestedIds.some((layerId) => !topLevelIds.includes(layerId))) {
          throw new Error(
            "创建文档根组时必须显式包含当前全部顶层图层。" + "期望：".concat(topLevelIds.join(", ") || "<empty>", "；实际：").concat(requestedIds.join(", ") || "<empty>", "。")
          );
        }
        const name = String(groupName || "").trim();
        if (!name) throw new Error("创建文档根组时必须提供 groupName。");
        if (topLevelLayers.length === 0) throw new Error("当前 PSD 没有可包入根组的顶层图层。");
        const allLayers = [];
        flattenLayers(topLevelLayers, allLayers);
        const before = allLayers.map((layer) => ({
          id: String(layer.id),
          name: layer.name,
          bounds: readBounds(layer),
          visible: layer.visible,
          opacity: layer.opacity
        }));
        return core.executeAsModal(async (executionContext) => {
          const freshIds = Array.from(requireDocument().layers || []).map((layer) => String(layer.id));
          if (String(requireDocument().id) !== String(document2.id) || freshIds.length !== topLevelIds.length || freshIds.some((id, index) => id !== topLevelIds[index])) {
            throw new Error("等待 Photoshop 执行期间文档或顶层图层已变化，请刷新后重试。");
          }
          const suspension = await executionContext.hostControl.suspendHistory({
            documentID: document2.id,
            name: "PSD2UI：创建文档根组 ".concat(name)
          });
          try {
            const group = await document2.createLayerGroup({
              name,
              fromLayers: topLevelLayers
            });
            if (!group) throw new Error("Photoshop 未能创建文档根组“".concat(name, "”。"));
            if (constants && constants.BlendMode && constants.BlendMode.PASSTHROUGH != null) {
              group.blendMode = constants.BlendMode.PASSTHROUGH;
            }
            const children = Array.from(group.layers || []).map((layer) => String(layer.id));
            if (document2.layers.length !== 1 || children.length !== topLevelIds.length || children.some((id, index) => id !== topLevelIds[index])) {
              throw new Error("建立根组改变了图层叠放顺序，已回滚。");
            }
            before.forEach((entry) => {
              const layer = findLayerById(group.layers || [], entry.id);
              if (!layer || layer.name !== entry.name || layer.visible !== entry.visible || layer.opacity !== entry.opacity) {
                throw new Error("建立根组改变了原图层名称或显示状态，已回滚。");
              }
              const bounds = readBounds(layer);
              if (Object.keys(entry.bounds).some((key) => Math.abs(bounds[key] - entry.bounds[key]) > 0.01)) {
                throw new Error("建立根组改变了图层位置或尺寸，已回滚。");
              }
            });
            const result = {
              id: String(group.id),
              name: String(group.name || name),
              childLayerIds: Array.from(group.layers || []).map((layer) => String(layer.id))
            };
            const value = typeof persist === "function" ? await persist(result) : result;
            await executionContext.hostControl.resumeHistory(suspension, true);
            return value;
          } catch (error) {
            await executionContext.hostControl.resumeHistory(suspension, false);
            throw error;
          }
        }, { commandName: "PSD2UI：创建文档根组 ".concat(name) });
      }
      module.exports = {
        requireDocument,
        openLocalDocument,
        getActiveLayerInfo,
        getActiveLayersInfo,
        getDocumentInfo,
        addSelectionChangeListener,
        createSnapshot,
        validateGroupSelection,
        selectLayersById,
        previewVisualState,
        restoreVisualStatePreview,
        structureActiveLayers,
        renameActiveLayers,
        applyConfirmedPreinitializeRenames,
        applyConfirmedStructurePlan,
        wrapTopLevelLayersInGroup,
        findLayerById,
        readLayer,
        asNumber
      };
    }
  });

  // Plus-ins/PSD2UI/src/uiResPath.js
  var require_uiResPath = __commonJS({
    "Plus-ins/PSD2UI/src/uiResPath.js"(exports, module) {
      "use strict";
      function normalizePath(value) {
        return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
      }
      function assertUiResFolder(folder) {
        const actualPath = normalizePath(folder && folder.nativePath);
        if (!folder || !actualPath) {
          throw new Error("请选择一个有效且已授权的输出目录。");
        }
        if (folder.isFolder === false) {
          throw new Error("输出目标必须是目录：".concat(folder.nativePath || "<unknown>"));
        }
        return folder;
      }
      module.exports = {
        normalizePath,
        assertUiResFolder
      };
    }
  });

  // Plus-ins/PSD2UI/src/exporter.js
  var require_exporter = __commonJS({
    "Plus-ins/PSD2UI/src/exporter.js"(exports, module) {
      "use strict";
      var { app, core, constants, imaging } = require_photoshop();
      var { storage } = require_uxp();
      var { findLayerById, openLocalDocument, asNumber } = require_photoshopDocument();
      var { assertUiResFolder } = require_uiResPath();
      var { collapseNineSlicePixels } = require_nineSlice();
      var { parseResourceLayerName } = require_naming();
      var FolderTokenKey = "psd2ui.uires-token.v1";
      var LegacyFolderTokenKey = "yoyoengine.psd2ui.uires-token";
      var exportInProgress = false;
      function toFileUrl(nativePath) {
        const normalized = String(nativePath || "").replace(/\\/g, "/");
        return /^[a-z]:\//i.test(normalized) ? "file:/".concat(normalized) : "file:".concat(normalized);
      }
      async function getRememberedUiResFolder() {
        const fileSystem = storage.localFileSystem;
        const token = localStorage.getItem(FolderTokenKey) || localStorage.getItem(LegacyFolderTokenKey);
        if (token) {
          try {
            const folder = assertUiResFolder(await fileSystem.getEntryForPersistentToken(token));
            if (!localStorage.getItem(FolderTokenKey)) {
              localStorage.setItem(FolderTokenKey, token);
              localStorage.removeItem(LegacyFolderTokenKey);
            }
            return folder;
          } catch (error) {
            localStorage.removeItem(FolderTokenKey);
            localStorage.removeItem(LegacyFolderTokenKey);
          }
        }
        return null;
      }
      async function chooseUiResFolder() {
        const fileSystem = storage.localFileSystem;
        const folder = assertUiResFolder(await fileSystem.getFolder());
        const persistentToken = await fileSystem.createPersistentToken(folder);
        localStorage.setItem(FolderTokenKey, persistentToken);
        localStorage.removeItem(LegacyFolderTokenKey);
        return folder;
      }
      function clearRememberedUiResFolder() {
        localStorage.removeItem(FolderTokenKey);
        localStorage.removeItem(LegacyFolderTokenKey);
      }
      async function resolveUiResFolder(options) {
        const input = options || {};
        if (input.uiResFolder) return assertUiResFolder(input.uiResFolder);
        if (String(input.uiResPath || "").trim()) {
          const explicitFolder = await storage.localFileSystem.getEntryWithUrl(
            toFileUrl(input.uiResPath)
          );
          return assertUiResFolder(explicitFolder);
        }
        const remembered = await getRememberedUiResFolder();
        if (remembered) return remembered;
        throw new Error("请先在 PSD2UI 插件中选择并授权输出目录。");
      }
      function assertOutputName(name) {
        if (!name || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
          throw new Error("[PSD2UI_OUTPUT_NAME_INVALID] 输出文件名无效：'".concat(name || "", "'。"));
        }
      }
      function assertBundleOutputNames(bundle) {
        if (!bundle || !bundle.document || !bundle.document.id || !Array.isArray(bundle.resources)) {
          throw new Error("[PSD2UI_BUNDLE_INVALID] 缺少 Bundle 文档身份或资源数组。");
        }
        const jsonName = "".concat(bundle.document.name, ".psd2ui.json");
        assertOutputName(jsonName);
        if (!String(bundle.document.name || "").trim()) throw new Error("[PSD2UI_OUTPUT_NAME_INVALID] 文档名不能为空。");
        const names = /* @__PURE__ */ new Set([jsonName.toLowerCase()]);
        bundle.resources.forEach((resource) => {
          if (!["sprite", "texture"].includes(resource.kind)) throw new Error("[PSD2UI_RESOURCE_KIND_INVALID] 图片类型必须为 sprite 或 texture。");
          resourceDirectory(resource);
          assertOutputName(resource.fileName);
          if (!resource.fileName.endsWith(".png") || names.has(resource.fileName.toLowerCase())) {
            throw new Error("[PSD2UI_RESOURCE_NAME_CONFLICT] 输出图片名重复或扩展名无效：".concat(resource.fileName, "。"));
          }
          names.add(resource.fileName.toLowerCase());
          if (bundle.schemaVersion === "1.5.0") {
            const parsed = parseResourceLayerName(resource.fileName.slice(0, -4), resource.sourceLayerId);
            if (parsed.fileName !== resource.fileName || parsed.group !== resource.module || resource.scope !== "module") {
              throw new Error("[PSD2UI_SOURCE_RESOURCE_INVALID] '".concat(resource.fileName, "' 未保留源图片分组。"));
            }
            const ids = resource.sourceLayerIds;
            if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length || !ids.includes(resource.sourceLayerId)) {
              throw new Error("[PSD2UI_RESOURCE_SOURCES_INVALID] '".concat(resource.fileName, "' 缺少唯一且包含主来源的 sourceLayerIds。"));
            }
          }
        });
      }
      function resourceIssue(code, message, resource) {
        const error = new Error("[".concat(code, "] ").concat(message));
        error.code = code;
        error.details = {
          resourceId: resource.id,
          sourceLayerId: resource.sourceLayerId,
          sourceLayerIds: resource.sourceLayerIds,
          fileName: resource.fileName
        };
        return error;
      }
      async function childFolder(parent, name, create = false) {
        if (!parent) return null;
        const found = (await parent.getEntries()).find((entry) => entry.name.toLowerCase() === name.toLowerCase());
        if (found && !found.isFolder) throw new Error("[PSD2UI_OUTPUT_PATH_CONFLICT] '".concat(found.nativePath, "' 应为目录。"));
        return found || (create ? await parent.createFolder(name) : null);
      }
      async function childFile(parent, name) {
        if (!parent) return null;
        const found = (await parent.getEntries()).find((entry) => entry.name.toLowerCase() === name.toLowerCase());
        if (found && !found.isFile) throw new Error("[PSD2UI_OUTPUT_PATH_CONFLICT] '".concat(found.nativePath, "' 应为文件。"));
        return found || null;
      }
      function resourceDirectory(resource) {
        if (!["sprite", "texture"].includes(resource.kind)) throw new Error("[PSD2UI_RESOURCE_KIND_INVALID] 图片类型必须为 sprite 或 texture。");
        assertOutputName(resource.module);
        if (!/^[a-z][a-z0-9_-]*$/.test(resource.module)) {
          throw resourceIssue("PSD2UI_RESOURCE_MODULE_INVALID", "资源 '".concat(resource.fileName, "' 的模块目录无效：'").concat(resource.module, "'。"), resource);
        }
        return "".concat(resource.kind, "/").concat(resource.module);
      }
      async function relativeFolder(parent, relative, create = false, created = []) {
        let current = parent;
        if (!relative) return current;
        for (const segment of relative.split("/")) {
          assertOutputName(segment);
          let next = await childFolder(current, segment);
          if (!next && create) {
            next = await childFolder(current, segment, true);
            created.push(next);
          }
          if (!next) return null;
          current = next;
        }
        return current;
      }
      async function existingResourceFile(folder, resource, legacyJson) {
        const directory = resourceDirectory(resource);
        assertOutputName(resource.fileName);
        if (legacyJson) {
          const legacy = await childFile(folder, resource.fileName);
          if (legacy) return legacy;
        }
        return await childFile(await relativeFolder(folder, directory), resource.fileName) || await childFile(await childFolder(folder, resource.kind), resource.fileName);
      }
      function sameResourceSettings(left, right) {
        return left.kind === right.kind && ["left", "top", "right", "bottom"].every(
          (key) => Number(left.sliceBorder && left.sliceBorder[key] || 0) === Number(right.sliceBorder && right.sliceBorder[key] || 0)
        );
      }
      async function assertBundleOwnership(folder, bundle) {
        assertBundleOutputNames(bundle);
        const jsonName = "".concat(bundle.document.name, ".psd2ui.json");
        const directories = {
          sprite: await childFolder(folder, "sprite"),
          texture: await childFolder(folder, "texture"),
          json: await childFolder(folder, "json")
        };
        const records = [];
        const legacyJson = [];
        const entries = [
          ...(await folder.getEntries()).map((entry) => ({ entry, legacy: true })),
          ...(directories.json ? await directories.json.getEntries() : []).map((entry) => ({ entry, legacy: false }))
        ];
        for (const { entry, legacy } of entries) {
          const entryName = String(entry && entry.name || "");
          if (!entry || !entry.isFile || !entryName.toLowerCase().endsWith(".psd2ui.json")) continue;
          let existing;
          try {
            existing = JSON.parse(await entry.read({ format: storage.formats.utf8 }));
          } catch (error) {
            throw new Error(
              "[PSD2UI_EXISTING_BUNDLE_INVALID] 无法读取既有 Bundle '".concat(entryName, "'：").concat(error.message)
            );
          }
          if (!existing || !existing.document || !Array.isArray(existing.resources)) {
            throw new Error("[PSD2UI_EXISTING_BUNDLE_INVALID] 既有 Bundle '".concat(entryName, "' 缺少文档或资源字段。"));
          }
          const sameDocument = String(existing.document.id || "") === String(bundle.document.id || "");
          if (sameDocument && entryName !== jsonName) {
            throw new Error(
              "[PSD2UI_DOCUMENT_ID_CONFLICT] document.id '".concat(bundle.document.id, "' 已属于 '").concat(entryName, "'。")
            );
          }
          if (entryName === jsonName && !sameDocument) {
            throw new Error(
              "[PSD2UI_BUNDLE_NAME_CONFLICT] '".concat(jsonName, "' 已属于另一个 document.id。")
            );
          }
          if (sameDocument) {
            if (legacy) legacyJson.push(entry);
          }
          if (!sameDocument && bundle.schemaVersion !== "1.5.0" && bundle.document.submodule && String(existing.document.module || "") === String(bundle.document.module || "") && String(existing.document.submodule || "") === String(bundle.document.submodule || "")) {
            throw new Error(
              "[PSD2UI_BUNDLE_SUBMODULE_CONFLICT] module/submodule " + "'".concat(bundle.document.module, "/").concat(bundle.document.submodule, "' 已属于 '").concat(entryName, "'。")
            );
          }
          records.push({ existing, entry, legacy, sameDocument });
        }
        const checks = /* @__PURE__ */ new Map();
        for (const resource of bundle.resources) {
          const target = await childFile(await relativeFolder(folder, resourceDirectory(resource)), resource.fileName);
          const comparisons = /* @__PURE__ */ new Map();
          let ownsTarget = false;
          for (const record of records) {
            const prior = record.existing.resources.find((value) => value && value.kind === resource.kind && String(value.fileName).toLowerCase() === resource.fileName.toLowerCase());
            if (!prior) continue;
            const priorFile = await existingResourceFile(folder, prior, record.legacy);
            if (record.sameDocument) {
              if (target && priorFile && target.nativePath === priorFile.nativePath) ownsTarget = true;
              continue;
            }
            if (!sameResourceSettings(resource, prior)) throw resourceIssue(
              "PSD2UI_RESOURCE_SETTINGS_CONFLICT",
              "公共图片 '".concat(resource.fileName, "' 与 '").concat(record.entry.name, "' 的九宫边框设置不同，无法共享同一 Unity 资源。"),
              resource
            );
            if (!priorFile) throw resourceIssue(
              "PSD2UI_SHARED_RESOURCE_MISSING",
              "'".concat(record.entry.name, "' 引用的公共图片 '").concat(resource.fileName, "' 不存在，无法比较图片内容。"),
              resource
            );
            comparisons.set(priorFile.nativePath, { file: priorFile, owner: record.entry.name });
          }
          if (target && (!ownsTarget || comparisons.size)) comparisons.set(
            target.nativePath,
            comparisons.get(target.nativePath) || { file: target, owner: "已有输出图片" }
          );
          checks.set(resource.id, { comparisons: Array.from(comparisons.values()), target });
        }
        return { checks, legacyJson, signature: JSON.stringify({
          records: records.map((record) => [record.entry.nativePath, record.existing]).sort((a, b) => a[0].localeCompare(b[0])),
          targets: Array.from(checks, ([id, check]) => [
            id,
            check.target && check.target.nativePath,
            check.comparisons.map((value) => value.file.nativePath)
          ])
        }) };
      }
      async function preflightExport(folder, bundle, sourceDocument) {
        assertUiResFolder(folder);
        assertBundleOutputNames(bundle);
        if (!sourceDocument) throw new Error("当前没有打开的 Photoshop 文档。");
        const referencedSources = /* @__PURE__ */ new Map();
        function visit(node) {
          if (!node) return;
          [node.image && node.image.resourceId, node.rawImage && node.rawImage.resourceId].filter(Boolean).forEach((id) => {
            if (!referencedSources.has(id)) referencedSources.set(id, /* @__PURE__ */ new Set());
            referencedSources.get(id).add(String(node.sourceLayerId));
          });
          (node.children || []).forEach(visit);
        }
        visit(bundle.root);
        for (const resource of bundle.resources) {
          const ids = bundle.schemaVersion === "1.5.0" ? resource.sourceLayerIds : [String(resource.sourceLayerId)];
          if (bundle.schemaVersion === "1.5.0") {
            const expected = referencedSources.get(resource.id) || /* @__PURE__ */ new Set();
            if (expected.size !== ids.length || ids.some((id) => !expected.has(id))) {
              throw new Error("[PSD2UI_RESOURCE_SOURCES_INVALID] '".concat(resource.fileName, "' 的像素校验来源与节点引用不一致。"));
            }
          }
          ids.forEach((id) => {
            const layer = findLayerById(sourceDocument.layers || [], id);
            if (!layer) throw new Error("[PSD2UI_RESOURCE_SOURCE_MISSING] 资源 '".concat(resource.fileName, "' 的源图层 ").concat(id, " 不存在。"));
            if (bundle.schemaVersion === "1.5.0" && parseResourceLayerName(layer.name, id).fileName !== resource.fileName) {
              throw new Error("[PSD2UI_SOURCE_NAME_CHANGED] 图片图层 ".concat(id, " '").concat(layer.name, "' 已变更，请重新检查后导出。"));
            }
          });
        }
        await assertBundleOwnership(folder, bundle);
        return { status: "ready", resourceCount: bundle.resources.length };
      }
      async function closeWithoutSaving(document2) {
        if (!document2) return;
        if (!app.activeDocument || String(app.activeDocument.id) !== String(document2.id)) {
          app.activeDocument = document2;
        }
        if (typeof document2.closeWithoutSaving === "function") {
          await document2.closeWithoutSaving();
          return;
        }
        await document2.close(constants.SaveOptions.DONOTSAVECHANGES);
      }
      function findOpenDocument(documentId) {
        return Array.from(app.documents || []).find((document2) => String(document2.id) === String(documentId)) || null;
      }
      function requireOpenDocument(documentId, label) {
        const document2 = findOpenDocument(documentId);
        if (document2) return document2;
        const openDocuments = Array.from(app.documents || []).map((entry) => "".concat(entry.id, ":").concat(entry.title || entry.name || "<untitled>", ":").concat(entry.path || "<unsaved>")).join(", ");
        throw new Error("".concat(label, "文档 ").concat(documentId, " 已不在 Photoshop 中；当前文档：").concat(openDocuments || "<empty>", "。"));
      }
      function isInternalTemporaryDocument(document2) {
        const title = String(document2 && (document2.title || document2.name) || "");
        return !String(document2 && document2.path || "").trim() && (title === "PSD2UI_Resource_Workbench" || title === "PSD2UI_NineSlice_Output");
      }
      async function closeStaleTemporaryDocuments() {
        const stale = Array.from(app.documents || []).filter(isInternalTemporaryDocument);
        for (const document2 of stale) await closeWithoutSaving(document2);
      }
      async function createTemporaryDocument(width, height, name) {
        await app.documents.add({
          width,
          height,
          resolution: 72,
          mode: "RGBColorMode",
          fill: "transparent",
          depth: 8,
          name
        });
        const document2 = app.activeDocument;
        const actualName = String(document2 && (document2.title || document2.name) || "");
        if (!document2 || actualName !== name || String(document2.path || "").trim()) {
          throw new Error(
            "[PSD2UI_TEMP_DOCUMENT_CREATE_FAILED] 临时文档创建后读回不符：" + "期望=".concat(name, "，实际=").concat(actualName || "<empty>", "。")
          );
        }
        return String(document2.id);
      }
      async function exportCollapsedNineSlice(workbenchId, outputFile, sliceBorder, verifyPixels) {
        const workbench = requireOpenDocument(workbenchId, "九宫工作台");
        const width = Math.round(asNumber(workbench.width));
        const height = Math.round(asNumber(workbench.height));
        const sourceResult = await imaging.getPixels({
          documentID: workbench.id,
          sourceBounds: { left: 0, top: 0, width, height },
          colorSpace: "RGB",
          componentSize: 8
        });
        let outputDocumentId = null;
        let outputImageData = null;
        try {
          const sourceImageData = sourceResult.imageData;
          const pixels = await sourceImageData.getData({ chunky: true });
          const collapsed = collapseNineSlicePixels(
            pixels,
            sourceImageData.width,
            sourceImageData.height,
            sourceImageData.components,
            sliceBorder
          );
          outputDocumentId = await createTemporaryDocument(
            collapsed.width,
            collapsed.height,
            "PSD2UI_NineSlice_Output"
          );
          const outputDocument = requireOpenDocument(outputDocumentId, "九宫输出");
          app.activeDocument = outputDocument;
          const targetLayer = outputDocument.layers && outputDocument.layers[0];
          if (!targetLayer) throw new Error("九宫输出文档没有可写入的像素图层。");
          outputImageData = await imaging.createImageDataFromBuffer(collapsed.pixels, {
            width: collapsed.width,
            height: collapsed.height,
            components: sourceImageData.components,
            chunky: true,
            colorSpace: sourceImageData.colorSpace || "RGB",
            colorProfile: sourceImageData.colorProfile || "sRGB IEC61966-2.1"
          });
          await imaging.putPixels({
            documentID: outputDocument.id,
            layerID: targetLayer.id,
            imageData: outputImageData,
            replace: true,
            targetBounds: { left: 0, top: 0, width: collapsed.width, height: collapsed.height }
          });
          await outputDocument.saveAs.png(outputFile, { compression: 6 }, true);
          return verifyPixels ? {
            width: collapsed.width,
            height: collapsed.height,
            components: sourceImageData.components,
            colorSpace: sourceImageData.colorSpace || "RGB",
            colorProfile: sourceImageData.colorProfile || "",
            pixels: new Uint8Array(collapsed.pixels)
          } : null;
        } finally {
          if (sourceResult && sourceResult.imageData) sourceResult.imageData.dispose();
          if (outputImageData) outputImageData.dispose();
          if (outputDocumentId) {
            await closeWithoutSaving(findOpenDocument(outputDocumentId));
          }
          app.activeDocument = requireOpenDocument(workbenchId, "九宫工作台");
        }
      }
      async function capturePixels(document2) {
        const result = await imaging.getPixels({
          documentID: document2.id,
          sourceBounds: { left: 0, top: 0, width: Math.round(asNumber(document2.width)), height: Math.round(asNumber(document2.height)) },
          colorSpace: "RGB",
          colorProfile: "sRGB IEC61966-2.1",
          componentSize: 8,
          applyAlpha: false
        });
        try {
          const data = result.imageData;
          return {
            width: data.width,
            height: data.height,
            components: data.components,
            canvasWidth: Math.round(asNumber(document2.width)),
            canvasHeight: Math.round(asNumber(document2.height)),
            left: result.sourceBounds && result.sourceBounds.left || 0,
            top: result.sourceBounds && result.sourceBounds.top || 0,
            colorSpace: data.colorSpace || "RGB",
            colorProfile: data.colorProfile || "",
            pixels: new Uint8Array(await data.getData({ chunky: true }))
          };
        } finally {
          if (result && result.imageData) result.imageData.dispose();
        }
      }
      function pixelsEqual(left, right) {
        if (!left || !right || left.width !== right.width || left.height !== right.height || left.canvasWidth !== right.canvasWidth || left.canvasHeight !== right.canvasHeight || left.left !== right.left || left.top !== right.top || left.colorSpace !== right.colorSpace || left.colorProfile !== right.colorProfile || ![3, 4].includes(left.components) || ![3, 4].includes(right.components) || left.pixels.length !== left.width * left.height * left.components || right.pixels.length !== right.width * right.height * right.components) return false;
        for (let index = 0; index < left.width * left.height; index += 1) {
          const a = index * left.components, b = index * right.components;
          const alphaLeft = left.components === 4 ? left.pixels[a + 3] : 255;
          const alphaRight = right.components === 4 ? right.pixels[b + 3] : 255;
          if (alphaLeft !== alphaRight) return false;
          for (let channel = 0; channel < 3; channel += 1) {
            if (alphaLeft && left.pixels[a + channel] !== right.pixels[b + channel]) return false;
          }
        }
        return true;
      }
      async function readPngPixels(file) {
        const previous = app.activeDocument;
        const openIds = new Set(Array.from(app.documents || []).map((document2) => String(document2.id)));
        let opened;
        try {
          await app.open(file);
          opened = app.activeDocument;
          if (!opened || openIds.has(String(opened.id))) throw new Error("读取 PNG 时未创建独立临时文档。");
          return await capturePixels(opened);
        } finally {
          if (opened && !openIds.has(String(opened.id))) await closeWithoutSaving(opened);
          if (previous && findOpenDocument(previous.id)) app.activeDocument = previous;
        }
      }
      async function exportResourcePng(sourceDocumentId, sourceLayerId, outputFile, sliceBorder, verifyPixels) {
        let sourceDocument = requireOpenDocument(sourceDocumentId, "资源源");
        let layer = findLayerById(sourceDocument.layers || [], sourceLayerId);
        if (!layer) throw new Error("资源源图层 ".concat(sourceLayerId, " 不存在。"));
        const sourceWidth = asNumber(sourceDocument.width);
        const sourceHeight = asNumber(sourceDocument.height);
        const sourceBounds = layer.bounds;
        let workbenchId = null;
        try {
          sourceDocument = requireOpenDocument(sourceDocumentId, "资源源");
          layer = findLayerById(sourceDocument.layers || [], sourceLayerId);
          if (!layer) throw new Error("资源源图层 ".concat(sourceLayerId, " 不存在。"));
          workbenchId = await createTemporaryDocument(
            sourceWidth,
            sourceHeight,
            "PSD2UI_Resource_Workbench"
          );
          const workbench = requireOpenDocument(workbenchId, "资源工作台");
          app.activeDocument = sourceDocument;
          const placement = constants.ElementPlacement ? constants.ElementPlacement.PLACEATBEGINNING : void 0;
          const copied = placement == null ? await layer.duplicate(requireOpenDocument(workbenchId, "资源工作台")) : await layer.duplicate(requireOpenDocument(workbenchId, "资源工作台"), placement);
          copied.visible = true;
          app.activeDocument = requireOpenDocument(workbenchId, "资源工作台");
          await copied.translate(-asNumber(sourceBounds.left), -asNumber(sourceBounds.top));
          const liveWorkbench = requireOpenDocument(workbenchId, "资源工作台");
          if (constants.TrimType && typeof liveWorkbench.trim === "function") {
            await liveWorkbench.trim(constants.TrimType.TRANSPARENT);
          }
          if (sliceBorder) {
            return await exportCollapsedNineSlice(
              workbenchId,
              outputFile,
              sliceBorder,
              verifyPixels
            );
          } else {
            await liveWorkbench.saveAs.png(outputFile, { compression: 6 }, true);
            return verifyPixels ? await capturePixels(liveWorkbench) : null;
          }
        } finally {
          if (workbenchId) {
            if (!findOpenDocument(sourceDocumentId)) {
              throw new Error(
                "[PSD2UI_SOURCE_DOCUMENT_LOST_BEFORE_WORKBENCH_CLOSE] " + "关闭资源工作台 ".concat(workbenchId, " 前，源 PSD ").concat(sourceDocumentId, " 已不在 Photoshop 中。")
              );
            }
            await closeWithoutSaving(findOpenDocument(workbenchId));
            if (findOpenDocument(workbenchId)) {
              throw new Error(
                "[PSD2UI_WORKBENCH_CLOSE_FAILED] 资源工作台 ".concat(workbenchId, " 关闭后仍然存在。")
              );
            }
            if (!findOpenDocument(sourceDocumentId)) {
              throw new Error(
                "[PSD2UI_SOURCE_DOCUMENT_CLOSED_WITH_WORKBENCH] " + "关闭资源工作台 ".concat(workbenchId, " 时误关了源 PSD ").concat(sourceDocumentId, "。")
              );
            }
          }
          app.activeDocument = requireOpenDocument(sourceDocumentId, "资源源");
        }
      }
      async function commitStagedFiles(folder, files, backupFolder, requiredDirectories = []) {
        const items = files.map((value) => value.file || value.remove ? __spreadProps(__spreadValues({}, value), { name: value.name || value.file.name, directory: value.directory || "" }) : { file: value, name: value.name, directory: "" });
        const folders = /* @__PURE__ */ new Map([["", folder]]);
        const created = [];
        const key = (item) => "".concat(item.directory, "/").concat(item.name);
        const backups = /* @__PURE__ */ new Map();
        try {
          for (const directory of /* @__PURE__ */ new Set([...requiredDirectories, ...items.map((item) => item.directory).filter(Boolean)])) {
            const target = await relativeFolder(folder, directory, true, created);
            folders.set(directory, target);
          }
          for (const item of items) {
            const prior = await childFile(folders.get(item.directory), item.name);
            if (prior) {
              const destination = await relativeFolder(backupFolder, item.directory, true);
              backups.set(key(item), await prior.copyTo(destination, { overwrite: false }));
            }
          }
          const manifests = items.filter((item) => item.name.toLowerCase().endsWith(".psd2ui.json"));
          const assets = items.filter((item) => !manifests.includes(item));
          const attempted = [];
          async function removePublished(item) {
            const target = await childFile(folders.get(item.directory), item.name);
            if (target) await target.delete();
          }
          try {
            for (const item of manifests) await removePublished(item);
            for (const item of assets.concat(manifests)) {
              if (item.remove) continue;
              attempted.push(key(item));
              await item.file.copyTo(folders.get(item.directory), { overwrite: true });
            }
          } catch (error) {
            const recoveryFailures = [];
            for (const item of manifests) {
              try {
                await removePublished(item);
              } catch (recoveryError) {
                recoveryFailures.push("".concat(key(item), ": 无法撤下发布入口：").concat(recoveryError.message));
              }
            }
            let assetRecoveryFailed = false;
            for (const item of assets.slice().reverse()) {
              const name = key(item);
              if (!attempted.includes(name)) continue;
              try {
                const backup = backups.get(name);
                if (backup) await backup.copyTo(folders.get(item.directory), { overwrite: true });
                else await removePublished(item);
              } catch (recoveryError) {
                assetRecoveryFailed = true;
                recoveryFailures.push("".concat(name, ": ").concat(recoveryError.message));
              }
            }
            if (!assetRecoveryFailed) {
              for (const item of manifests) {
                const prior = backups.get(key(item));
                if (!prior) continue;
                try {
                  await prior.copyTo(folders.get(item.directory), { overwrite: true });
                } catch (recoveryError) {
                  recoveryFailures.push("".concat(key(item), ": ").concat(recoveryError.message));
                  try {
                    await removePublished(item);
                  } catch (removeError) {
                    recoveryFailures.push("".concat(key(item), ": 无法撤下失败的 JSON：").concat(removeError.message));
                  }
                }
              }
            }
            if (recoveryFailures.length) {
              const recovery = new Error("[PSD2UI_EXPORT_RECOVERY_FAILED] 导出失败且部分资源恢复失败；备份位于 ".concat(backupFolder.nativePath, "。") + "原错误：".concat(error.message, "；恢复错误：").concat(recoveryFailures.join("；")));
              recovery.preserveExportBackup = true;
              throw recovery;
            }
            throw error;
          }
        } catch (error) {
          for (const directory of created.slice().reverse()) {
            try {
              if (!(await directory.getEntries()).length) await directory.delete();
            } catch (_) {
            }
          }
          throw error;
        }
      }
      async function writeBundle(bundle, options) {
        if (exportInProgress) throw new Error("[PSD2UI_EXPORT_BUSY] 已有导出正在执行，请等待完成后重试。");
        exportInProgress = true;
        try {
          return await writeBundleUnlocked(JSON.parse(JSON.stringify(bundle)), options);
        } finally {
          exportInProgress = false;
        }
      }
      async function verifyBundle(bundle, options) {
        return writeBundle(bundle, __spreadProps(__spreadValues({}, options), { checkOnly: true }));
      }
      function sameBytes(left, right) {
        if (typeof left === "string" || typeof right === "string") return left === right;
        const a = new Uint8Array(left), b = new Uint8Array(right);
        if (a.length !== b.length) return false;
        for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
        return true;
      }
      async function writeBundleUnlocked(bundle, options) {
        const sourceDocument = app.activeDocument;
        if (!sourceDocument) throw new Error("当前没有打开的 Photoshop 文档。");
        const sourceDocumentPath = String(sourceDocument.path || "");
        const folder = await resolveUiResFolder(options);
        await preflightExport(folder, bundle, sourceDocument);
        const temporaryRoot = await storage.localFileSystem.getTemporaryFolder();
        const transactionFolder = await temporaryRoot.createFolder("psd2ui-export-".concat(Date.now(), "-").concat(Math.random().toString(36).slice(2)));
        const stage = await transactionFolder.createFolder("staged");
        const backup = await transactionFolder.createFolder("backup");
        const files = [];
        const stagedResources = /* @__PURE__ */ new Map();
        let reusedResourceCount = 0;
        let checkedOwnership;
        const checkedFiles = /* @__PURE__ */ new Map();
        let preserveBackup = false;
        try {
          await core.executeAsModal(
            closeStaleTemporaryDocuments,
            { commandName: "PSD2UI：清理残留图片导出工作台" }
          );
          if (sourceDocumentPath) await openLocalDocument(sourceDocumentPath);
          const sourceDocumentId = String(app.activeDocument.id);
          try {
            await core.executeAsModal(async () => {
              for (let index = 0; index < bundle.resources.length; index += 1) {
                const resource = bundle.resources[index];
                const sourceIds = bundle.schemaVersion === "1.5.0" ? resource.sourceLayerIds : [String(resource.sourceLayerId)];
                let referencePixels = null;
                for (let candidateIndex = 0; candidateIndex < sourceIds.length; candidateIndex += 1) {
                  const liveSourceDocument = requireOpenDocument(sourceDocumentId, "导出源");
                  const layer = findLayerById(liveSourceDocument.layers || [], sourceIds[candidateIndex]);
                  if (!layer) throw new Error("资源 ".concat(resource.fileName, " 的源图层 ").concat(sourceIds[candidateIndex], " 不存在。"));
                  const file = await stage.createFile(candidateIndex === 0 ? resource.fileName : "verify-".concat(index, "-").concat(candidateIndex, ".png"), { overwrite: false });
                  await exportResourcePng(sourceDocumentId, String(layer.id), file, resource.sliceBorder, false);
                  const pixels = sourceIds.length > 1 ? await readPngPixels(file) : null;
                  if (candidateIndex === 0) {
                    referencePixels = pixels;
                    stagedResources.set(resource.id, file);
                  } else if (!pixelsEqual(referencePixels, pixels)) {
                    throw resourceIssue("PSD2UI_RESOURCE_CONTENT_CONFLICT", "同名图片 '".concat(resource.fileName, "' 的实际像素不同：") + "图层 ".concat(sourceIds[0], " 与 ").concat(sourceIds[candidateIndex], "。输出目录尚未写入。"), resource);
                  }
                }
              }
              const ownership = await assertBundleOwnership(folder, bundle);
              checkedOwnership = ownership.signature;
              for (let index = 0; index < bundle.resources.length; index += 1) {
                const resource = bundle.resources[index];
                let file = stagedResources.get(resource.id);
                const check = ownership.checks.get(resource.id);
                if (check.target) checkedFiles.set(check.target.nativePath, {
                  file: check.target,
                  bytes: await check.target.read({ format: storage.formats.binary })
                });
                const reference = check.comparisons.length ? await readPngPixels(file) : null;
                let equalFile = null;
                for (let candidateIndex = 0; candidateIndex < check.comparisons.length; candidateIndex += 1) {
                  const comparison = check.comparisons[candidateIndex];
                  const comparisonFolder = await transactionFolder.createFolder("compare-".concat(index, "-").concat(candidateIndex));
                  const copy = await comparison.file.copyTo(comparisonFolder, { overwrite: false });
                  checkedFiles.set(comparison.file.nativePath, {
                    file: comparison.file,
                    bytes: await copy.read({ format: storage.formats.binary })
                  });
                  if (!pixelsEqual(reference, await readPngPixels(copy))) throw resourceIssue(
                    "PSD2UI_RESOURCE_CONTENT_CONFLICT",
                    "公共图片 '".concat(resource.fileName, "' 与 '").concat(comparison.owner, "' 的现有 PNG 尺寸或像素不同。") + "当前来源图层：".concat(resource.sourceLayerIds || resource.sourceLayerId, "；已有图片：").concat(comparison.file.nativePath, "。输出目录尚未写入。"),
                    resource
                  );
                  equalFile = copy;
                }
                if (equalFile) {
                  reusedResourceCount += 1;
                  if (check.target) continue;
                  file = equalFile;
                }
                files.push({ file, directory: resourceDirectory(resource) });
              }
              ownership.legacyJson.forEach((file) => files.push({ remove: true, name: file.name }));
              app.activeDocument = requireOpenDocument(sourceDocumentId, "导出源");
            }, { commandName: "PSD2UI：导出 UI 图片" });
          } finally {
            await core.executeAsModal(
              closeStaleTemporaryDocuments,
              { commandName: "PSD2UI：关闭图片导出工作台" }
            );
            if (sourceDocumentPath) await openLocalDocument(sourceDocumentPath);
          }
          if ((await assertBundleOwnership(folder, bundle)).signature !== checkedOwnership) {
            throw new Error("[PSD2UI_EXPORT_TARGET_CHANGED] 比较期间输出目录的资源声明发生变化，请重新预检。");
          }
          for (const { file, bytes } of checkedFiles.values()) {
            if (!sameBytes(bytes, await file.read({ format: storage.formats.binary }))) {
              throw new Error("[PSD2UI_EXPORT_TARGET_CHANGED] 比较期间 '".concat(file.nativePath, "' 已被修改，请重新预检。"));
            }
          }
          if (options && options.checkOnly) return { status: "ready", resourceCount: bundle.resources.length, reusedResourceCount };
          const jsonFile = await stage.createFile("".concat(bundle.document.name, ".psd2ui.json"), { overwrite: false });
          await jsonFile.write(JSON.stringify(bundle, null, 2), { format: storage.formats.utf8 });
          files.push({ file: jsonFile, directory: "json" });
          await commitStagedFiles(folder, files, backup, ["sprite", "texture", "json"]);
          return {
            folder: folder.nativePath,
            json: "".concat(folder.nativePath.replace(/[\\/]+$/, ""), "/json/").concat(jsonFile.name),
            resourceCount: bundle.resources.length,
            reusedResourceCount
          };
        } catch (error) {
          preserveBackup = Boolean(error.preserveExportBackup);
          throw error;
        } finally {
          if (!preserveBackup) {
            try {
              await transactionFolder.delete();
            } catch (_) {
            }
          }
        }
      }
      module.exports = {
        getRememberedUiResFolder,
        chooseUiResFolder,
        clearRememberedUiResFolder,
        resolveUiResFolder,
        assertBundleOwnership,
        assertBundleOutputNames,
        resourceDirectory,
        preflightExport,
        commitStagedFiles,
        pixelsEqual,
        verifyBundle,
        writeBundle
      };
    }
  });

  // Plus-ins/PSD2UI/app.js
  var require_app = __commonJS({
    "Plus-ins/PSD2UI/app.js"() {
      "use strict";
      var { core: photoshopCore } = require_photoshop();
      var Psd2Ui = require_core();
      var { describePreflightIssues } = require_preflightIssues();
      var {
        getDocumentXmp,
        readManifest,
        readSidecarManifest,
        readSidecarRaw,
        restoreSidecarRaw,
        setDocumentXmp,
        writeManifest,
        writeManifestInCurrentModal
      } = require_xmpStore();
      var {
        getActiveLayerInfo,
        getActiveLayersInfo,
        getDocumentInfo,
        addSelectionChangeListener,
        createSnapshot,
        structureActiveLayers,
        validateGroupSelection,
        selectLayersById,
        previewVisualState,
        restoreVisualStatePreview,
        renameActiveLayers,
        applyConfirmedPreinitializeRenames,
        applyConfirmedStructurePlan,
        findLayerById,
        openLocalDocument,
        requireDocument,
        wrapTopLevelLayersInGroup,
        readLayer
      } = require_photoshopDocument();
      var {
        getRememberedUiResFolder,
        chooseUiResFolder,
        clearRememberedUiResFolder,
        verifyBundle,
        writeBundle
      } = require_exporter();
      var HumanContext = { actor: "human-panel" };
      var McpContext = { actor: "mcp" };
      var PanelShell = window.Psd2UiPanelShell;
      function element(id) {
        return document.getElementById(id);
      }
      var currentUiResFolder = null;
      var draftDocumentKey = "";
      var draftManifest = null;
      var componentSelection = [];
      var componentSelectionKey = "";
      var componentOptions = {};
      var componentInputs = { roles: [], previews: [], layout: [] };
      var selectionIssueLayerIds = [];
      var visualStateSelectionKey = "";
      var visualStateInputs = [];
      var savedDocumentKey = "";
      var preparationDocumentKey = "";
      var authoringRefreshVersion = 0;
      var operationRunning = false;
      var returnComponent = null;
      var preflightContext = null;
      var componentSaveDocumentKey = "";
      var moduleInputDocumentKey = "";
      var moduleInputDirty = false;
      var authoringStateCache = /* @__PURE__ */ new Map();
      function documentKey() {
        const document2 = requireDocument();
        return "".concat(String(document2.id), "|").concat(getDocumentInfo().path);
      }
      function selectionKey() {
        try {
          return "".concat(documentKey(), "|").concat(Array.from(requireDocument().activeLayers || []).map((layer) => String(layer.id)).sort().join(","));
        } catch (error) {
          return "";
        }
      }
      function isCurrentRefresh(version, selection) {
        if (version !== authoringRefreshVersion) return false;
        if (selection !== selectionKey()) {
          scheduleSelectionRefresh();
          return false;
        }
        return true;
      }
      function requireSameDocument(key) {
        if (documentKey() !== key) throw new Error("操作期间切换了 PSD，请回到原文档后重试。");
      }
      function showElement(id, visible) {
        const target = element(id);
        if (!target) return;
        if (visible) target.classList.remove("is-hidden");
        else target.classList.add("is-hidden");
      }
      async function ensureAuthoringManifest() {
        const info = getDocumentInfo();
        const liveDocument = requireDocument();
        const key = "".concat(String(liveDocument.id), "|").concat(info.path);
        const stored = await readManifest();
        requireSameDocument(key);
        savedDocumentKey = stored ? key : "";
        const current = stored || (draftDocumentKey === key ? draftManifest : null);
        if (current) return Psd2Ui.projectAutomaticImageSemantics(
          __spreadProps(__spreadValues({}, current), { resourceNaming: "source" }),
          createSnapshot(current.document.rootLayerId)
        );
        const rootLayerId = "document-root";
        const snapshot = createSnapshot(rootLayerId);
        draftManifest = Psd2Ui.executeAuthoringCommand(null, {
          command: "initialize-document",
          input: {
            module: "document",
            resourceNaming: "source",
            name: info.name,
            width: info.width,
            height: info.height,
            rootLayerId,
            rootLayerName: info.name,
            snapshot
          }
        }, HumanContext).manifest;
        draftDocumentKey = key;
        return draftManifest;
      }
      function renderPreparationState(manifest) {
        let info;
        try {
          info = getDocumentInfo();
          requireDocument();
        } catch (error) {
          info = null;
        }
        const key = info ? documentKey() : "";
        if (moduleInputDocumentKey !== key) {
          moduleInputDocumentKey = key;
          moduleInputDirty = false;
        }
        const moduleName = manifest && manifest.document && manifest.document.module || "";
        if (!moduleInputDirty) element("document-module").value = moduleName === "document" ? "" : moduleName;
        element("set-module").disabled = !manifest;
        element("document-module-status").textContent = !manifest ? "打开 PSD 后读取所属模块。" : moduleName === "document" ? "尚未指定业务模块：当前暂用 document。导出前请填写并保存所属模块。" : "当前配置：".concat(moduleName, "。修改后点击“保存所属模块”或保存文档准备。");
        const ready = Boolean(manifest && savedDocumentKey === key);
        element("preparation-badge").textContent = ready ? "已准备" : info ? "待保存配置" : "等待 PSD";
        element("preparation-title").textContent = ready ? "可以开始配置组件了" : info ? "为这份 PSD 建立配置" : "先打开并保存本地 PSD";
        element("preparation-description").textContent = ready ? "已读取保存的组件。重新准备只同步图层变化，保留已有配置。" : "点击下方按钮完成初始化；配置会写入 PSD 和同目录配置文件。";
        element("prepare-document").textContent = ready ? "同步文档，保留组件配置" : "初始化并保存配置";
        element("prepare-document").disabled = !info || !manifest;
        element("start-components").disabled = !info || !manifest;
        showElement("prepare-reminder", !ready);
        const layers = info ? Array.from(requireDocument().layers || []) : [];
        const grouped = layers.length === 1 && Psd2Ui.isGroupLayer(readLayer(layers[0]));
        element("wrap-document-root").disabled = !manifest || !layers.length || grouped;
        element("wrap-document-root").textContent = grouped ? "已有一个根组" : "将全部图层放入根组";
        element("root-group-summary").textContent = grouped ? "全部图层已在「".concat(layers[0].name, "」中，无需再次套组。") : layers.length ? "将收进全部 ".concat(layers.length, " 个顶层图层和组。") : "打开 PSD 后读取图层。";
        if (preparationDocumentKey !== key) {
          preparationDocumentKey = key;
          element("root-group-name").value = info ? info.name : "";
          PanelShell.activatePanel(ready ? "layer" : "prepare");
        }
      }
      async function prepareDocument() {
        const key = documentKey();
        const moduleName = element("document-module").value.trim();
        let current = await ensureAuthoringManifest();
        requireSameDocument(key);
        if (moduleName) current = Psd2Ui.executeAuthoringCommand(current, {
          command: "set-document-module",
          input: { module: moduleName }
        }, HumanContext).manifest;
        const persisted = await persistManifest(current);
        moduleInputDirty = false;
        return {
          document: persisted.manifest.document.name,
          module: persisted.manifest.document.module,
          preservedConfiguration: true,
          sidecarPath: persisted.writeResult.sidecarPath
        };
      }
      async function saveDocumentModule() {
        const key = documentKey();
        const moduleName = element("document-module").value.trim();
        if (!moduleName) throw new Error("请填写界面所属模块，例如 baoleizhengduo。");
        const current = await ensureAuthoringManifest();
        requireSameDocument(key);
        const result = Psd2Ui.executeAuthoringCommand(current, {
          command: "set-document-module",
          input: { module: moduleName }
        }, HumanContext);
        const persisted = await persistManifest(result.manifest);
        moduleInputDirty = false;
        return { module: persisted.manifest.document.module, sidecarPath: persisted.writeResult.sidecarPath };
      }
      async function wrapDocumentRoot() {
        const key = documentKey();
        const name = String(element("root-group-name").value || "").trim();
        if (!name) throw new Error("请填写根组名称。");
        const current = await ensureAuthoringManifest();
        requireSameDocument(key);
        const layers = Array.from(requireDocument().layers || []);
        if (layers.length === 1 && Psd2Ui.isGroupLayer(readLayer(layers[0]))) {
          return { reused: true, rootGroup: layers[0].name };
        }
        return runDocumentMutationWithManifestRollback(current, (persistInMutation) => wrapTopLevelLayersInGroup(layers.map((layer) => String(layer.id)), name, async (group) => {
          const persisted = await persistInMutation(current);
          return {
            rootGroup: group.name,
            layerCount: group.childLayerIds.length,
            sidecarPath: persisted.writeResult.sidecarPath
          };
        }));
      }
      function requireLayersInAuthoringRoot(manifest, layers) {
        const root = createSnapshot(manifest.document.rootLayerId).root;
        for (const layer of layers) {
          if (!findSnapshotLayer([root], layer.id || layer.layerId)) {
            throw new Error("「".concat(layer.name, "」在当前文档配置的根组之外。请在「").concat(root.name, "」组内配置组件；本次尚未保存。"));
          }
        }
      }
      function renderUiResFolder(folder, status) {
        currentUiResFolder = folder || null;
        element("uires-path").value = folder && folder.nativePath || "";
        element("uires-status").textContent = status || (folder ? "目录已授权；导出只会写入此目录。" : "请选择并授权一个可写目录。");
        element("export-output-summary").textContent = folder ? "输出到：".concat(folder.nativePath, "；图片放入 sprite/模块名 或 texture/模块名，JSON 放入 json。") : "请先在上方选择输出目录。";
      }
      async function refreshUiResFolder() {
        const folder = await getRememberedUiResFolder();
        renderUiResFolder(folder);
        return folder;
      }
      function requireUiResFolder() {
        if (!currentUiResFolder) {
          PanelShell.activatePanel("export");
          throw new Error("请先在“检查导出”中选择输出目录。");
        }
        return currentUiResFolder;
      }
      function writeStatus(value, summary) {
        const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
        element("status").value = text;
        element("status-summary").textContent = summary || text.split("\n")[0] || "等待操作。";
        element("status-summary").classList.remove("is-error");
        element("status-summary").classList.remove("is-success");
        if (summary && summary.includes("失败")) element("status-summary").classList.add("is-error");
        else if (summary && summary.includes("成功")) element("status-summary").classList.add("is-success");
      }
      function formatError(error) {
        if (error && error.issues) {
          return "".concat(error.message, "\n").concat(error.issues.map((entry) => "- [".concat(entry.code, "] ").concat(entry.path ? "".concat(entry.path, ": ") : "").concat(entry.message)).join("\n"));
        }
        const diagnostics = error && error.details && error.details.diagnostics;
        if (Array.isArray(diagnostics) && diagnostics.length > 0) {
          return "".concat(error.message, "\n").concat(diagnostics.map((entry) => "- [".concat(entry.code, "] ").concat(entry.message)).join("\n"));
        }
        return error && error.message ? error.message : String(error);
      }
      function setStatusExpanded(expanded) {
        PanelShell.setStatusExpanded(expanded);
      }
      async function run(label, callback, options) {
        if (operationRunning) return null;
        operationRunning = true;
        authoringRefreshVersion += 1;
        authoringStateCache.clear();
        try {
          if (globalThis.__PSD2UI_REFRESH_HOST__) await globalThis.__PSD2UI_REFRESH_HOST__();
          if (!options || options.keepVisualPreview !== true) await restoreVisualStatePreview();
          writeStatus("".concat(label, "：执行中……"), "".concat(label, "：执行中"));
          const result = await callback();
          refreshContext();
          await refreshAuthoringState();
          writeStatus({ operation: label, success: true, result }, "".concat(label, "成功"));
          return result;
        } catch (error) {
          if (Array.isArray(error && error.layerIds)) {
            selectionIssueLayerIds = error.layerIds.map(String);
            showElement("locate-selection-issue", selectionIssueLayerIds.length > 0);
          }
          const message = "".concat(label, "失败：\n").concat(formatError(error));
          writeStatus(message, "".concat(label, "失败"));
          if (options && options.reportPreflight) {
            renderPreflightFailure(error);
            setStatusExpanded(false);
          } else setStatusExpanded(true);
          console.error(error);
          return null;
        } finally {
          operationRunning = false;
        }
      }
      function captureBaseline(manifest, context) {
        if (!manifest || !manifest.document || !manifest.document.rootLayerId) return manifest;
        const snapshot = createSnapshot(manifest.document.rootLayerId);
        return Psd2Ui.executeAuthoringCommand(
          manifest,
          { command: "capture-baseline", input: { snapshot } },
          context || HumanContext
        ).manifest;
      }
      async function persistManifest(manifest, writer, context) {
        const key = documentKey();
        const snapshot = createSnapshot(manifest.document.rootLayerId);
        const synchronized = Psd2Ui.executeAuthoringCommand(manifest, {
          command: "sync-layer-tree",
          input: { snapshot }
        }, context || HumanContext);
        const persisted = captureBaseline(synchronized.manifest, context);
        const writeResult = await (writer || writeManifest)(persisted, true);
        requireSameDocument(key);
        const readback = await readManifest();
        requireSameDocument(key);
        assertJsonEqual(readback, persisted, "保存后的组件配置");
        savedDocumentKey = key;
        draftManifest = persisted;
        draftDocumentKey = key;
        return {
          manifest: persisted,
          writeResult,
          diagnostics: synchronized.value.diagnostics,
          reconciliation: synchronized.value.reconciliation
        };
      }
      async function restoreManifestPersistence(document2, backup) {
        return photoshopCore.executeAsModal(async () => {
          const rollbackErrors = [];
          try {
            await setDocumentXmp(backup.xmp);
          } catch (error) {
            rollbackErrors.push("PSD XMP：".concat(formatError(error)));
          }
          try {
            await restoreSidecarRaw(backup.sidecar);
          } catch (error) {
            rollbackErrors.push("同目录配置镜像：".concat(formatError(error)));
          }
          try {
            await document2.save();
          } catch (error) {
            rollbackErrors.push("PSD 保存：".concat(formatError(error)));
          }
          try {
            if (await getDocumentXmp() !== backup.xmp) {
              throw new Error("恢复后的原始 XMP 字节不一致。");
            }
            assertJsonEqual(await readSidecarRaw(document2), backup.sidecar, "恢复后的同目录配置镜像");
          } catch (error) {
            rollbackErrors.push("回滚读回：".concat(formatError(error)));
          }
          if (rollbackErrors.length > 0) throw new Error(rollbackErrors.join("；"));
        }, { commandName: "PSD2UI：恢复图层变更前的 Manifest" });
      }
      async function runDocumentMutationWithManifestRollback(current, operation) {
        const document2 = requireDocument();
        const backup = current ? {
          xmp: await getDocumentXmp(),
          sidecar: await readSidecarRaw(document2)
        } : null;
        let persistenceStarted = false;
        const persistInCurrentMutation = async (manifest, context) => {
          const persisted = await persistManifest(manifest, async (prepared) => {
            persistenceStarted = true;
            return writeManifestInCurrentModal(prepared, false);
          }, context);
          await assertPersistedManifest(persisted.manifest, document2, "文档变更保存前");
          await document2.save();
          await assertPersistedManifest(persisted.manifest, document2, "文档变更保存后");
          return persisted;
        };
        try {
          return await operation(persistInCurrentMutation);
        } catch (error) {
          draftManifest = null;
          draftDocumentKey = "";
          savedDocumentKey = "";
          if (!backup || !persistenceStarted) throw error;
          try {
            await restoreManifestPersistence(document2, backup);
          } catch (rollbackError) {
            throw new Error("".concat(formatError(error), "\nManifest 回滚失败：").concat(formatError(rollbackError)));
          }
          throw error;
        }
      }
      async function executeWithContext(command, input, context) {
        const current = await readManifest();
        const result = Psd2Ui.executeAuthoringCommand(current, { command, input }, context);
        const persisted = await persistManifest(result.manifest, null, context);
        return { manifest: persisted.manifest, value: result.value, writeResult: persisted.writeResult };
      }
      async function execute(command, input) {
        return executeWithContext(command, input, HumanContext);
      }
      function handlePanelChanged(panelName) {
        element("current-layer").title = element("current-layer").textContent;
        refreshContext();
        refreshAuthoringState().catch((error) => console.error("刷新 PSD2UI 配置状态失败。", error));
      }
      function setAdvancedResourceVisible(visible) {
        PanelShell.setAdvancedResourceVisible(visible);
      }
      function updateSemanticOptions() {
        PanelShell.updateSemanticOptions();
        showElement("slice-fields", element("image-type").value === "sliced");
      }
      function setSemantic(semantic, resetValues) {
        if (semantic === "group" || semantic === "view") semantic = "";
        const registered = PanelShell.SemanticEntries.some((entry) => entry.name === semantic);
        if (!registered && semantic !== "") return;
        element("semantic").value = semantic;
        if (resetValues) {
          if (semantic === "image") resetImageDefaults();
          if (semantic === "text") resetTextDefaults();
        }
        updateSemanticOptions();
      }
      function resetImageDefaults() {
        element("image-type").value = "simple";
        showElement("slice-fields", false);
        element("slice-left").value = "0";
        element("slice-top").value = "0";
        element("slice-right").value = "0";
        element("slice-bottom").value = "0";
      }
      function resetTextDefaults() {
        element("font-key").value = "default";
      }
      function readNumber(id, label, options) {
        const value = Number(element(id).value);
        if (!Number.isFinite(value)) throw new Error("".concat(label, "必须是有效数字。"));
        if (options && options.integer && !Number.isInteger(value)) throw new Error("".concat(label, "必须是整数。"));
        if (options && options.min != null && value < options.min) {
          throw new Error("".concat(label, "不能小于 ").concat(options.min, "。"));
        }
        return value;
      }
      function buildNodeParameters(semantic) {
        if (semantic === "image") {
          const imageType = element("image-type").value;
          return {
            image: {
              imageType,
              sliceBorder: imageType === "sliced" ? {
                left: readNumber("slice-left", "九宫左边距", { min: 0, integer: true }),
                top: readNumber("slice-top", "九宫上边距", { min: 0, integer: true }),
                right: readNumber("slice-right", "九宫右边距", { min: 0, integer: true }),
                bottom: readNumber("slice-bottom", "九宫下边距", { min: 0, integer: true })
              } : null
            }
          };
        }
        if (semantic === "text") {
          const fontKey = String(element("font-key").value || "").trim();
          if (!fontKey) throw new Error("fontKey 不能为空。");
          return { text: { fontKey } };
        }
        return {};
      }
      function requireSingleSelection(operation) {
        const selected = getActiveLayersInfo();
        if (selected.length !== 1) {
          throw new Error("".concat(operation, "要求只选择 1 个图层；当前选择了 ").concat(selected.length, " 个。组合组件请先在 Photoshop 中建组并只选择该组。"));
        }
        return selected[0];
      }
      function withAuthoringState(layers, manifest) {
        const nodes = manifest && manifest.nodes || {};
        function decorate(layer) {
          const layerId = String(layer && (layer.layerId != null ? layer.layerId : layer.id) || "");
          const node = nodes[layerId];
          return __spreadProps(__spreadValues({}, layer), {
            id: layer && layer.id != null ? String(layer.id) : layerId,
            layerId,
            semantic: node ? node.semantic : "",
            structure: node ? node.structure : null,
            visualStates: node ? node.visualStates : null,
            viewport: node ? node.viewport : null,
            children: (layer && layer.children || []).map(decorate)
          });
        }
        return (layers || []).map(decorate);
      }
      function semanticDisplayName(semantic) {
        const entry = PanelShell.SemanticEntries.find((candidate) => candidate.name === semantic);
        if (entry) return entry.title;
        if (semantic === "view") return "界面根 / View";
        if (semantic === "group") return "普通容器 / Group";
        return semantic || "尚未解析";
      }
      function clearChildren(target) {
        while (target && target.firstChild) target.removeChild(target.firstChild);
      }
      function showComponentSaveReceipt(manifest, layerId, expectedSemantic) {
        const node = manifest.nodes[String(layerId)];
        if (!node || node.semantic !== expectedSemantic) {
          throw new Error("图层 #".concat(layerId, " 的组件保存结果与 ").concat(semanticDisplayName(expectedSemantic), " 不一致，请重新读取配置。"));
        }
        componentSaveDocumentKey = documentKey();
        element("component-save-feedback").textContent = "最近已保存：".concat(node.name, " · #").concat(layerId, " → ").concat(semanticDisplayName(node.semantic), "。");
      }
      function appendOption(select, value, label) {
        const option = document.createElement("option");
        option.value = String(value || "");
        option.textContent = label;
        select.appendChild(option);
      }
      function findSnapshotLayer(layers, layerId) {
        for (const layer of layers || []) {
          if (String(layer.layerId || layer.id) === String(layerId)) return layer;
          const nested = findSnapshotLayer(layer.children || [], layerId);
          if (nested) return nested;
        }
        return null;
      }
      function readComponentOptions() {
        const options = { roles: [], previewLayerIds: [], autoLayout: componentOptions.autoLayout !== false };
        componentInputs.roles.forEach((entry) => {
          if (entry.input.value) options.roles.push({ name: entry.name, layerId: String(entry.input.value) });
        });
        const template = options.roles.find((role) => role.name === "item-template" || role.name === "cell-template");
        if (template) options.templateLayerId = template.layerId;
        componentInputs.previews.forEach((entry) => {
          if (entry.input.checked && entry.layerId !== options.templateLayerId) options.previewLayerIds.push(entry.layerId);
        });
        if (componentInputs.layout.length) {
          options.layout = {};
          componentInputs.layout.forEach((entry) => {
            options.layout[entry.name] = entry.name === "direction" ? entry.input.value : Number(entry.input.value);
          });
        }
        options.groupName = String(element("component-group-name").value || "").trim();
        if (componentInputs.viewportEnabled) {
          options.viewport = componentInputs.viewportEnabled.checked ? {
            width: Number(componentInputs.viewportWidth.value),
            height: Number(componentInputs.viewportHeight.value)
          } : null;
        }
        return options;
      }
      function updateAutomaticCollectionLayout(semantic, options) {
        if (!["list", "grid"].includes(semantic)) return;
        const status = element("component-layout-status");
        if (!options.autoLayout) {
          status.textContent = "保留已保存或手动调整的布局；需要时可根据当前图层重新计算。";
          return;
        }
        const template = findSnapshotLayer(componentSelection, options.templateLayerId);
        if (!template) {
          status.textContent = "选择模板后，自动读取同级格子的尺寸、行列数和间距。";
          return;
        }
        const size = (layer) => ({
          width: Number(layer.bounds.right) - Number(layer.bounds.left),
          height: Number(layer.bounds.bottom) - Number(layer.bounds.top)
        });
        const templateSize = size(template);
        const members = componentSelection.length === 1 ? componentSelection[0].children : componentSelection;
        const candidates = Psd2Ui.collectComponentCandidates(members || []);
        const samples = options.previewLayerIds.length ? [template, ...options.previewLayerIds.map((id) => findSnapshotLayer(componentSelection, id)).filter(Boolean)] : [template, ...candidates.filter((layer) => {
          if (!Psd2Ui.isGroupLayer(layer) || String(layer.layerId) === String(template.layerId) || String(layer.parentId) !== String(template.parentId)) return false;
          const candidateSize = size(layer);
          return Math.abs(candidateSize.width - templateSize.width) <= 1 && Math.abs(candidateSize.height - templateSize.height) <= 1;
        })];
        if (samples.length < 2) {
          status.textContent = "只有一个模板，已读取尺寸；间距和行列数可手动调整。";
          return;
        }
        try {
          const measured = Psd2Ui.suggestCollectionLayout(semantic, samples);
          options.layout = measured.layout;
          componentInputs.layout.forEach((entry) => {
            entry.input.value = String(measured.layout[entry.name]);
          });
          const layout = measured.layout;
          const summary = semantic === "grid" ? "".concat(layout.columns, " 列 × ").concat(layout.rows, " 行，横向间距 ").concat(layout.horizontalSpacing, "px，纵向间距 ").concat(layout.verticalSpacing, "px") : "".concat(layout.direction === "horizontal" ? "横向" : "纵向", "排列，间距 ").concat(layout.spacing, "px");
          status.textContent = "已按 ".concat(samples.length, " 个同级样例计算：").concat(summary, "。").concat(measured.diagnostics.map((issue) => issue.message).join(""));
        } catch (error) {
          status.textContent = "自动计算未完成：".concat(formatError(error), " 可调整图层后重算，或直接修改布局参数。");
          throw error;
        }
      }
      function recalculateComponentLayout() {
        const fresh = getActiveLayersInfo();
        if (fresh.map((layer) => String(layer.id)).join(",") !== componentSelection.map((layer) => String(layer.id)).join(",")) {
          writeStatus("选择已变化，请重新选择要配置的组。", "重新计算布局失败");
          return;
        }
        const nodes = {};
        function collect(layer) {
          nodes[String(layer.layerId)] = layer;
          (layer.children || []).forEach(collect);
        }
        componentSelection.forEach(collect);
        componentSelection = withAuthoringState(fresh, { nodes });
        componentOptions.autoLayout = true;
        validateComponentDraft();
      }
      function validateComponentDraft() {
        const semantic = element("semantic").value;
        const status = element("component-configuration-status");
        const requiresGroup = componentSelection.length > 1;
        let valid = false;
        try {
          componentOptions = readComponentOptions();
          updateAutomaticCollectionLayout(semantic, componentOptions);
          Psd2Ui.planStructuredSelection(semantic, componentSelection, componentOptions);
          if (componentOptions.viewport && (!(componentOptions.viewport.width > 0) || !(componentOptions.viewport.height > 0))) {
            throw new Error("可视范围的宽度和高度必须大于 0。");
          }
          if (requiresGroup) validateGroupSelection(componentSelection);
          if (requiresGroup && !componentOptions.groupName) throw new Error("请填写新组件组名称。");
          status.textContent = requiresGroup ? "角色已就绪；组合后会保留原有位置与叠放顺序。" : "角色已就绪；保存将更新当前组的配置。";
          valid = true;
          selectionIssueLayerIds = [];
        } catch (error) {
          status.textContent = formatError(error);
          selectionIssueLayerIds = (error.layerIds || []).map(String);
        }
        element("selection-constraint").textContent = status.textContent;
        element("structure-component").disabled = !valid || requiresGroup;
        element("combine-component").disabled = !valid || !requiresGroup;
        showElement("locate-selection-issue", selectionIssueLayerIds.length > 0);
        const summary = element("component-role-summary");
        clearChildren(summary);
        componentInputs.roles.forEach((entry) => {
          const layer = findSnapshotLayer(componentSelection, entry.input.value);
          const line = document.createElement("p");
          line.textContent = "".concat(entry.label || entry.name, " → ").concat(layer ? layer.name : "未指定");
          summary.appendChild(line);
        });
        return valid;
      }
      function renderComponentEditor(force) {
        const semantic = element("semantic").value;
        const enabled = Psd2Ui.requiresStructure(semantic) && (componentSelection.length > 1 || componentSelection.length === 1 && Psd2Ui.isGroupLayer(componentSelection[0]));
        showElement("component-editor", enabled);
        showElement("component-layout-tools", enabled && ["list", "grid"].includes(semantic));
        if (!enabled) return;
        const docInfo = getDocumentInfo();
        const key = "".concat(docInfo.path, "|").concat(componentSelection.map((layer) => layer.layerId || layer.id).join(","), "|").concat(semantic);
        if (!force && componentSelectionKey === key) {
          validateComponentDraft();
          return;
        }
        const previousKey = componentSelectionKey;
        componentSelectionKey = key;
        if (previousKey !== key) {
          const existing = componentSelection.length === 1 && componentSelection[0].semantic === semantic ? componentSelection[0].structure : null;
          componentOptions = existing ? {
            roles: (existing.roles || []).map((role) => ({ name: role.name, layerId: role.layerId })),
            previewLayerIds: (existing.previewLayerIds || []).slice(),
            layout: existing.layout,
            viewport: componentSelection[0].viewport || null,
            autoLayout: false
          } : {};
        }
        ["component-role-fields", "component-preview-fields", "component-layout-fields", "component-viewport-fields"].forEach((id) => clearChildren(element(id)));
        componentInputs = { roles: [], previews: [], layout: [] };
        let description;
        try {
          description = Psd2Ui.describeStructuredSelection(semantic, componentSelection, componentOptions);
        } catch (error) {
          element("component-configuration-status").textContent = formatError(error);
          element("structure-component").disabled = true;
          element("combine-component").disabled = true;
          return;
        }
        showElement("component-group-name-field", description.requiresGroup);
        element("component-group-name").value = componentOptions.groupName || description.groupName || "组件";
        description.roles.forEach((role) => {
          const label = document.createElement("label");
          label.className = "role-field";
          const caption = document.createElement("span");
          caption.textContent = "".concat(role.label || role.name).concat(role.required ? " *" : "（可选）");
          label.appendChild(caption);
          const select = document.createElement("select");
          appendOption(select, "", role.required ? "请选择图层" : "不使用");
          role.candidates.forEach((candidate) => appendOption(
            select,
            candidate.layerId,
            "".concat(candidate.path || candidate.name, " · #").concat(candidate.layerId)
          ));
          select.value = role.selectedLayerId || "";
          select.addEventListener("change", () => {
            componentOptions = readComponentOptions();
            if (role.name === "item-template" || role.name === "cell-template") {
              const template = findSnapshotLayer(componentSelection, select.value);
              if (template) {
                const bounds = template.bounds || {};
                const layout = componentOptions.layout || {};
                layout[semantic === "list" ? "itemWidth" : "cellWidth"] = Number(bounds.right) - Number(bounds.left);
                layout[semantic === "list" ? "itemHeight" : "cellHeight"] = Number(bounds.bottom) - Number(bounds.top);
                componentOptions.layout = layout;
              }
              renderComponentEditor(true);
            } else validateComponentDraft();
          });
          label.appendChild(select);
          const help = document.createElement("small");
          const hints = {
            background: "选择负责点击区域的底图；图标和光效可作为装饰保留。",
            label: "选择显示标题的文字层，可留空。",
            text: "选择实际显示输入内容的文字层。",
            placeholder: "选择未输入时显示的提示文字。",
            "on-graphic": "选择开启或选中时出现的图案。",
            "item-template": "选择包含一整项内容的组，内部可以有按钮、文字和图标。",
            "cell-template": "选择一整个格子组，工具会用它生成重复格子。"
          };
          help.textContent = hints[role.name] || "选择该角色对应的完整组件；先配置内部组件，再配置外层。";
          label.appendChild(help);
          const locate = document.createElement("button");
          locate.type = "button";
          locate.className = "text-action";
          locate.textContent = "在 Photoshop 中定位";
          locate.addEventListener("click", () => {
            if (select.value) {
              returnComponent = {
                documentKey: documentKey(),
                layerIds: componentSelection.map((layer) => String(layer.id || layer.layerId)),
                semantic,
                options: readComponentOptions()
              };
              showElement("return-to-component", true);
              run("定位角色图层", () => selectLayersById([select.value]));
            }
          });
          label.appendChild(locate);
          element("component-role-fields").appendChild(label);
          componentInputs.roles.push({ name: role.name, label: role.label, input: select });
        });
        if (semantic === "list" || semantic === "grid") {
          const options = readComponentOptions();
          const templateId = options.templateLayerId;
          const template = findSnapshotLayer(componentSelection, templateId);
          const bounds = template && template.bounds || {};
          const heading = document.createElement("p");
          heading.className = "field-help";
          heading.textContent = "仅预览样例：勾选的组留在 PSD，不生成重复条目。未勾选的内容保留。";
          element("component-preview-fields").appendChild(heading);
          description.previewCandidates.filter((candidate) => candidate.layerId !== templateId).forEach((candidate) => {
            const label = document.createElement("label");
            label.className = "check-row";
            const input = document.createElement("input");
            input.type = "checkbox";
            input.checked = (componentOptions.previewLayerIds || []).includes(candidate.layerId);
            input.addEventListener("change", validateComponentDraft);
            const caption = document.createElement("span");
            caption.textContent = "".concat(candidate.path || candidate.name, " · #").concat(candidate.layerId);
            label.appendChild(input);
            label.appendChild(caption);
            element("component-preview-fields").appendChild(label);
            componentInputs.previews.push({ layerId: candidate.layerId, input });
          });
          const list = semantic === "list";
          const layout = description.layout || (list ? {
            direction: "vertical",
            itemWidth: Number(bounds.right) - Number(bounds.left) || 1,
            itemHeight: Number(bounds.bottom) - Number(bounds.top) || 1,
            spacing: 0
          } : {
            cellWidth: Number(bounds.right) - Number(bounds.left) || 1,
            cellHeight: Number(bounds.bottom) - Number(bounds.top) || 1,
            columns: 1,
            rows: 1,
            horizontalSpacing: 0,
            verticalSpacing: 0
          });
          const labels = {
            direction: "排列方向",
            itemWidth: "条目宽度",
            itemHeight: "条目高度",
            spacing: "条目间距",
            cellWidth: "单元格宽度",
            cellHeight: "单元格高度",
            columns: "列数",
            rows: "预览行数",
            horizontalSpacing: "横向间距",
            verticalSpacing: "纵向间距"
          };
          const fields = list ? ["direction", "itemWidth", "itemHeight", "spacing"] : ["cellWidth", "cellHeight", "columns", "rows", "horizontalSpacing", "verticalSpacing"];
          fields.forEach((name) => {
            const label = document.createElement("label");
            const caption = document.createElement("span");
            caption.textContent = labels[name];
            label.appendChild(caption);
            const input = document.createElement(name === "direction" ? "select" : "input");
            if (name === "direction") {
              appendOption(input, "vertical", "纵向");
              appendOption(input, "horizontal", "横向");
            } else {
              input.type = "number";
              input.min = name.toLowerCase().includes("spacing") ? "0" : "1";
              input.step = "1";
            }
            input.value = String(layout[name]);
            input.addEventListener("change", () => {
              componentOptions.autoLayout = false;
              validateComponentDraft();
            });
            label.appendChild(input);
            element("component-layout-fields").appendChild(label);
            componentInputs.layout.push({ name, input });
          });
          const viewportContainer = element("component-viewport-fields");
          const toggleLabel = document.createElement("label");
          toggleLabel.className = "check-row";
          const enabled2 = document.createElement("input");
          enabled2.type = "checkbox";
          enabled2.checked = Boolean(componentOptions.viewport);
          const toggleText = document.createElement("span");
          toggleText.textContent = "单独设置列表可视范围";
          toggleLabel.appendChild(enabled2);
          toggleLabel.appendChild(toggleText);
          viewportContainer.appendChild(toggleLabel);
          componentInputs.viewportEnabled = enabled2;
          const allBounds = componentSelection.map((layer) => layer.bounds || {});
          const defaultViewport = {
            width: Math.max(...allBounds.map((box) => box.right || 0)) - Math.min(...allBounds.map((box) => box.left || 0)),
            height: Math.max(...allBounds.map((box) => box.bottom || 0)) - Math.min(...allBounds.map((box) => box.top || 0))
          };
          ["width", "height"].forEach((name) => {
            const label = document.createElement("label");
            const caption = document.createElement("span");
            caption.textContent = name === "width" ? "可视宽度" : "可视高度";
            label.appendChild(caption);
            const input = document.createElement("input");
            input.type = "number";
            input.min = "1";
            input.value = String((componentOptions.viewport || defaultViewport)[name]);
            input.disabled = !enabled2.checked;
            input.addEventListener("change", validateComponentDraft);
            label.appendChild(input);
            viewportContainer.appendChild(label);
            componentInputs[name === "width" ? "viewportWidth" : "viewportHeight"] = input;
          });
          enabled2.addEventListener("change", () => {
            componentInputs.viewportWidth.disabled = !enabled2.checked;
            componentInputs.viewportHeight.disabled = !enabled2.checked;
            validateComponentDraft();
          });
        }
        validateComponentDraft();
      }
      function applyViewportOptions(manifest, layerId, semantic, options, sourceBounds) {
        if (!["list", "grid"].includes(semantic) || !Object.prototype.hasOwnProperty.call(options, "viewport")) return manifest;
        return Psd2Ui.executeAuthoringCommand(manifest, {
          command: "set-node-viewport",
          input: { layerId, viewport: options.viewport, sourceBounds }
        }, HumanContext).manifest;
      }
      function readVisualStates() {
        if (!visualStateInputs.length) return null;
        const states = visualStateInputs.map((entry) => ({ name: String(entry.name.value || "").trim(), layerId: String(entry.layer.value || "") }));
        const selected = visualStateInputs.findIndex((entry) => entry.defaultInput.checked);
        return { defaultState: selected >= 0 ? states[selected].name : "", states };
      }
      function validateVisualStateDraft() {
        const value = readVisualStates();
        const preview = element("visual-state-preview-choice");
        const oldChoice = preview.value;
        clearChildren(preview);
        (value && value.states || []).forEach((state) => appendOption(preview, state.name, state.name || "未命名状态"));
        preview.value = value && value.states.some((state) => state.name === oldChoice) ? oldChoice : value && value.defaultState || "";
        try {
          if (value) Psd2Ui.planVisualStates(componentSelection[0], value);
          element("save-visual-states").disabled = false;
          element("preview-visual-state").disabled = !value;
          element("visual-state-status").textContent = value ? "状态配置可保存；预览不写入 PSD 文件。" : "没有状态；保存将清除当前组的状态配置。";
        } catch (error) {
          element("save-visual-states").disabled = true;
          element("preview-visual-state").disabled = true;
          element("visual-state-status").textContent = formatError(error);
        }
      }
      function addVisualStateRow(state, isDefault) {
        const group = componentSelection[0];
        const candidates = Psd2Ui.collectComponentCandidates(group.children || []).filter(Psd2Ui.isGroupLayer);
        const row = document.createElement("div");
        row.className = "issue-row";
        const name = document.createElement("input");
        name.placeholder = "状态名称，如 正常 / 锁定";
        name.value = state && state.name || "";
        const layer = document.createElement("select");
        appendOption(layer, "", "选择状态组");
        candidates.forEach((candidate) => appendOption(layer, candidate.layerId, "".concat(candidate.name, " · #").concat(candidate.layerId)));
        layer.value = state && state.layerId || "";
        const defaultLabel = document.createElement("label");
        defaultLabel.className = "check-row";
        const defaultInput = document.createElement("input");
        defaultInput.type = "checkbox";
        defaultInput.checked = Boolean(isDefault);
        const defaultText = document.createElement("span");
        defaultText.textContent = "默认状态";
        defaultLabel.appendChild(defaultInput);
        defaultLabel.appendChild(defaultText);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "text-action";
        remove.textContent = "移除此状态";
        const entry = { name, layer, defaultInput, row };
        name.addEventListener("change", validateVisualStateDraft);
        layer.addEventListener("change", validateVisualStateDraft);
        defaultInput.addEventListener("change", () => {
          if (defaultInput.checked) visualStateInputs.forEach((other) => {
            if (other !== entry) other.defaultInput.checked = false;
          });
          validateVisualStateDraft();
        });
        remove.addEventListener("click", () => {
          visualStateInputs = visualStateInputs.filter((other) => other !== entry);
          element("visual-state-rows").removeChild(row);
          validateVisualStateDraft();
        });
        row.appendChild(name);
        row.appendChild(layer);
        row.appendChild(defaultLabel);
        row.appendChild(remove);
        element("visual-state-rows").appendChild(row);
        visualStateInputs.push(entry);
      }
      function renderVisualStateEditor(force) {
        const group = componentSelection.length === 1 && Psd2Ui.isGroupLayer(componentSelection[0]) ? componentSelection[0] : null;
        showElement("visual-states-editor", Boolean(group));
        if (!group) {
          visualStateSelectionKey = "";
          return;
        }
        const key = "".concat(getDocumentInfo().path, "|").concat(group.layerId);
        if (!force && visualStateSelectionKey === key) return;
        visualStateSelectionKey = key;
        clearChildren(element("visual-state-rows"));
        visualStateInputs = [];
        const value = group.visualStates;
        (value && value.states || []).forEach((state) => addVisualStateRow(state, state.name === value.defaultState));
        validateVisualStateDraft();
      }
      async function saveVisualStates() {
        const current = await ensureAuthoringManifest();
        const selected = withAuthoringState([requireSingleSelection("保存视觉状态")], current)[0];
        const value = readVisualStates();
        const visualStates = value ? Psd2Ui.planVisualStates(selected, value) : null;
        const result = Psd2Ui.executeAuthoringCommand(current, {
          command: "set-visual-states",
          input: { layerId: selected.layerId, visualStates }
        }, HumanContext);
        const persisted = await persistManifest(result.manifest);
        visualStateSelectionKey = "";
        return { layerId: selected.layerId, visualStates, sidecarPath: persisted.writeResult.sidecarPath };
      }
      function updateSelectionControls(layers, manifest, preferredSemantic, blockedReason) {
        const authoredLayers = withAuthoringState(layers, manifest);
        componentSelection = authoredLayers;
        showElement("image-rename-card", authoredLayers.length > 0 && authoredLayers.every((layer) => Psd2Ui.normalizeLayerKind(layer) === "image"));
        const structureRootSummary = element("structure-root-summary");
        if (structureRootSummary) {
          if (blockedReason) {
            structureRootSummary.textContent = blockedReason;
          } else if (authoredLayers.length !== 1) {
            structureRootSummary.textContent = authoredLayers.length === 0 ? "请选择一个代表完整组件的 Photoshop 图层组" : "当前选中 ".concat(authoredLayers.length, " 个图层；可选择类型后组合为组件");
          } else if (Psd2Ui.normalizeLayerKind(authoredLayers[0]) !== "group") {
            structureRootSummary.textContent = "".concat(authoredLayers[0].name, "（不是图层组）");
          } else {
            const group = authoredLayers[0];
            const bounds = group.bounds || {};
            const width = Math.max(0, Number(bounds.right || 0) - Number(bounds.left || 0));
            const height = Math.max(0, Number(bounds.bottom || 0) - Number(bounds.top || 0));
            structureRootSummary.textContent = "".concat(group.name, " · ").concat(Psd2Ui.summarizeSelection(group.children || []), " · ").concat(width, " × ").concat(height, " px");
          }
        }
        const savedComponent = authoredLayers.length === 1 && authoredLayers[0].structure ? authoredLayers[0] : null;
        const availability = Psd2Ui.evaluateSemanticAvailability(authoredLayers, savedComponent ? { bySemantic: { [savedComponent.semantic]: savedComponent.structure } } : void 0);
        PanelShell.setSemanticAvailability(availability, preferredSemantic, blockedReason);
        renderComponentEditor(false);
        renderVisualStateEditor(false);
        return authoredLayers;
      }
      async function applySelectedPreset() {
        const key = documentKey();
        const layer = requireSingleSelection("写入组件语义");
        const semantic = element("semantic").value;
        const parameters = buildNodeParameters(semantic);
        let manifest = await ensureAuthoringManifest();
        requireSameDocument(key);
        requireLayersInAuthoringRoot(manifest, [layer]);
        Psd2Ui.requireSemanticAction(withAuthoringState([layer], manifest), semantic, "apply");
        const nodeName = String(layer.name || "").trim();
        let result = Psd2Ui.executeAuthoringCommand(manifest, {
          command: "apply-node-preset",
          input: { layerId: layer.id, name: nodeName, semantic }
        }, HumanContext);
        manifest = result.manifest;
        if (Object.keys(parameters).length > 0) {
          result = Psd2Ui.executeAuthoringCommand(manifest, {
            command: "update-node-parameters",
            input: { layerId: layer.id, parameters }
          }, HumanContext);
          manifest = result.manifest;
        }
        const persisted = await persistManifest(manifest);
        showComponentSaveReceipt(persisted.manifest, layer.id, semantic);
        return {
          layerId: layer.id,
          layerName: layer.name,
          nodeName,
          semantic,
          parameters,
          reconciliation: persisted.reconciliation,
          sidecarPath: persisted.writeResult.sidecarPath
        };
      }
      async function structureSelectedComponent() {
        const key = selectionKey();
        const semantic = element("semantic").value;
        const options = readComponentOptions();
        const persistedCurrent = await ensureAuthoringManifest();
        if (selectionKey() !== key) throw new Error("读取配置期间选择已变化，请重新选择组件后保存。");
        const synchronized = Psd2Ui.executeAuthoringCommand(persistedCurrent, {
          command: "sync-layer-tree",
          input: { snapshot: createSnapshot(persistedCurrent.document.rootLayerId) }
        }, HumanContext);
        const current = synchronized.manifest;
        const selected = withAuthoringState(getActiveLayersInfo(), current);
        requireLayersInAuthoringRoot(current, selected);
        componentSelection = selected;
        updateAutomaticCollectionLayout(semantic, options);
        Psd2Ui.requireSemanticAction(selected, semantic, "structure", options);
        const group = selected[0];
        const plan = Psd2Ui.planStructuredGroup(semantic, group, options);
        const result = Psd2Ui.executeAuthoringCommand(current, {
          command: "apply-structured-group",
          input: {
            layerId: plan.rootLayerId,
            name: plan.groupName,
            semantic: plan.semantic,
            structure: plan.structure
          }
        }, HumanContext);
        const configured = applyViewportOptions(result.manifest, plan.rootLayerId, semantic, options, group.bounds);
        const persisted = await persistManifest(configured);
        showComponentSaveReceipt(persisted.manifest, plan.rootLayerId, semantic);
        componentSelectionKey = "";
        return {
          groupLayerId: plan.rootLayerId,
          groupName: plan.groupName,
          semantic: plan.semantic,
          roles: plan.structure.roles,
          previewLayerIds: plan.structure.previewLayerIds,
          reconciliation: persisted.reconciliation,
          sidecarPath: persisted.writeResult.sidecarPath
        };
      }
      async function combineSelectedComponent() {
        const key = selectionKey();
        const semantic = element("semantic").value;
        const options = readComponentOptions();
        const current = await ensureAuthoringManifest();
        if (selectionKey() !== key) throw new Error("读取配置期间选择已变化，请重新选择组件后保存。");
        const selected = withAuthoringState(getActiveLayersInfo(), current);
        requireLayersInAuthoringRoot(current, selected);
        validateGroupSelection(selected);
        componentSelection = selected;
        updateAutomaticCollectionLayout(semantic, options);
        const plan = Psd2Ui.planStructuredSelection(semantic, selected, options);
        if (!plan.requiresGroup) throw new Error("当前已有组件组，请使用“保存组件配置”。");
        if (!options.groupName) throw new Error("请填写新组件组名称。");
        plan.groupName = options.groupName;
        return runDocumentMutationWithManifestRollback(current, (persistInMutation) => structureActiveLayers(plan, async (created) => {
          const snapshot = createSnapshot(current.document.rootLayerId);
          const synchronized = Psd2Ui.executeAuthoringCommand(current, {
            command: "sync-layer-tree",
            input: { snapshot }
          }, HumanContext).manifest;
          const group = withAuthoringState([readLayer(created.layer)], synchronized)[0];
          const finalPlan = Psd2Ui.planStructuredGroup(semantic, group, options);
          const result = Psd2Ui.executeAuthoringCommand(synchronized, {
            command: "apply-structured-group",
            input: {
              layerId: finalPlan.rootLayerId,
              name: finalPlan.groupName,
              semantic,
              structure: finalPlan.structure
            }
          }, HumanContext);
          const configured = applyViewportOptions(result.manifest, finalPlan.rootLayerId, semantic, options, group.bounds);
          const persisted = await persistInMutation(configured);
          showComponentSaveReceipt(persisted.manifest, finalPlan.rootLayerId, semantic);
          componentSelectionKey = "";
          return {
            groupLayerId: finalPlan.rootLayerId,
            groupName: finalPlan.groupName,
            semantic,
            roles: finalPlan.structure.roles,
            sidecarPath: persisted.writeResult.sidecarPath
          };
        }));
      }
      async function batchRenameSelectedLayers() {
        const selected = getActiveLayersInfo();
        const baseName = String(element("batch-rename-base").value || "").trim();
        if (!Psd2Ui.isEnglishNodeName(baseName)) {
          throw new Error("批量改名基础名必须以英文字母开头，并且只能包含英文字母、数字和下划线。");
        }
        const start = readNumber("batch-rename-start", "起始序号", { integer: true, min: 0 });
        const width = Math.max(2, String(start + selected.length - 1).length);
        const renames = selected.map((layer, index) => ({
          layerId: layer.id,
          previousName: layer.name,
          name: selected.length === 1 ? baseName : "".concat(baseName).concat(String(start + index).padStart(width, "0"))
        }));
        const current = await readManifest();
        return runDocumentMutationWithManifestRollback(current, (persistInMutation) => renameActiveLayers(renames, async () => {
          if (!current) return { manifestUpdated: false, reason: "当前 PSD 尚未初始化" };
          const persisted = await persistInMutation(current);
          return {
            manifestUpdated: true,
            reconciliation: persisted.reconciliation,
            sidecarPath: persisted.writeResult.sidecarPath
          };
        }));
      }
      async function syncLayerTreeToManifest() {
        const manifest = await ensureAuthoringManifest();
        const persisted = await persistManifest(manifest);
        return {
          reconciliation: persisted.reconciliation,
          diagnostics: persisted.diagnostics,
          sidecarPath: persisted.writeResult.sidecarPath
        };
      }
      function refreshContext() {
        const result = { document: null, layers: [] };
        try {
          const info = getDocumentInfo();
          if (componentSaveDocumentKey && componentSaveDocumentKey !== documentKey()) {
            componentSaveDocumentKey = "";
            element("component-save-feedback").textContent = "";
          }
          if (preflightContext && preflightContext.documentKey !== documentKey()) {
            preflightContext = null;
            clearPreflightReport();
          }
          if (returnComponent && returnComponent.documentKey !== documentKey()) {
            returnComponent = null;
            showElement("return-to-component", false);
          }
          result.document = { name: info.name, path: info.path, width: info.width, height: info.height };
          element("current-document").textContent = "".concat(info.name, " · ").concat(info.width, " × ").concat(info.height);
          element("document-size").textContent = "".concat(info.width, " × ").concat(info.height, " px");
        } catch (error) {
          element("current-document").textContent = "没有打开本地 PSD";
          element("document-size").textContent = "—";
        }
        try {
          const selected = getActiveLayersInfo();
          result.layers = selected.map((layer) => ({ id: layer.id, name: layer.name }));
          const label = selected.length === 1 ? "".concat(selected[0].name, " · #").concat(selected[0].id) : "已选择 ".concat(selected.length, " 个图层");
          element("current-layer").textContent = label;
          element("editing-layer").textContent = label;
        } catch (error) {
          element("current-layer").textContent = "没有选中图层";
          element("editing-layer").textContent = "请先选择 Photoshop 图层";
        }
        return result;
      }
      function loadNodeIntoFields(node) {
        if (!node) return;
        setSemantic(node.semantic, false);
        if (node.semantic === "image" && node.image) {
          element("image-type").value = node.image.imageType || "simple";
          const border = node.image.sliceBorder || {};
          element("slice-left").value = String(border.left || 0);
          element("slice-top").value = String(border.top || 0);
          element("slice-right").value = String(border.right || 0);
          element("slice-bottom").value = String(border.bottom || 0);
          showElement("slice-fields", element("image-type").value === "sliced");
        }
        if (node.semantic === "text" && node.text) {
          element("font-key").value = node.text.fontKey || "default";
        }
      }
      async function refreshAuthoringState(options) {
        const version = ++authoringRefreshVersion;
        const selection = selectionKey();
        const revision = typeof photoshopCore.getDocumentRevision === "function" ? photoshopCore.getDocumentRevision() : null;
        const key = selection ? documentKey() : "";
        const cached = options && options.reuseDocument && revision != null ? authoringStateCache.get(key) : null;
        const reuse = cached && cached.revision === revision;
        let manifest;
        if (reuse) {
          manifest = cached.manifest;
          savedDocumentKey = cached.savedDocumentKey;
          element("sidecar-path").textContent = cached.sidecarLabel;
          element("document-change-status").textContent = cached.changeLabel;
        } else {
          authoringStateCache.delete(key);
          try {
            const sidecar = await readSidecarManifest();
            if (!isCurrentRefresh(version, selection)) return null;
            const label = sidecar.manifest ? " · revision ".concat(sidecar.manifest.revision || 0) : " · 尚未生成";
            element("sidecar-path").textContent = "".concat(sidecar.path).concat(label);
          } catch (error) {
            element("sidecar-path").textContent = "当前文档不是已保存的本地 PSD";
          }
          try {
            manifest = await ensureAuthoringManifest();
            if (!isCurrentRefresh(version, selection)) return null;
          } catch (error) {
            if (!isCurrentRefresh(version, selection)) return null;
            renderPreparationState(null);
            element("layer-config-status").textContent = "无法读取当前 PSD 的配置。";
            element("effective-semantic").textContent = "读取失败";
            element("layer-change-summary").textContent = formatError(error);
            updateSelectionControls([], null, element("semantic").value, "无法读取当前 PSD 的配置。");
            return null;
          }
        }
        renderPreparationState(manifest);
        if (!manifest) {
          element("layer-config-status").textContent = "请选择已保存本地 PSD 的图层。";
          element("effective-semantic").textContent = "等待文档";
          element("layer-change-summary").textContent = "尚无保存基线。";
          element("document-change-status").textContent = "尚无保存基线。";
          updateSelectionControls([], null, element("semantic").value, "请先打开已保存的本地 PSD。");
          return null;
        }
        if (manifest.document) {
          element("document-name").value = manifest.document.name || "";
          element("document-submodule").value = manifest.document.submodule || "";
        }
        if (!reuse) try {
          const documentChanges = Psd2Ui.diffSnapshotFromBaseline(
            manifest,
            createSnapshot(manifest.document.rootLayerId)
          );
          element("document-change-status").textContent = documentChanges.length === 0 ? "整个界面根与上次保存一致。" : "".concat(documentChanges.length, " 个图层相对上次保存有变化：").concat(documentChanges.slice(0, 3).map((entry) => entry.name).join("、")).concat(documentChanges.length > 3 ? "……" : "");
        } catch (error) {
          element("document-change-status").textContent = "无法比较：".concat(formatError(error));
        }
        if (!reuse && revision != null && revision === photoshopCore.getDocumentRevision()) {
          authoringStateCache.set(key, {
            revision,
            manifest,
            savedDocumentKey,
            sidecarLabel: element("sidecar-path").textContent,
            changeLabel: element("document-change-status").textContent
          });
          if (authoringStateCache.size > 4) authoringStateCache.delete(authoringStateCache.keys().next().value);
        }
        let selected;
        try {
          selected = getActiveLayersInfo();
        } catch (error) {
          element("layer-config-status").textContent = "请在 Photoshop 中选择图层。";
          element("effective-semantic").textContent = "未选择";
          element("layer-change-summary").textContent = "未选择图层，无法比较变化。";
          updateSelectionControls([], manifest, element("semantic").value, "请先选择一个或多个 Photoshop 图层。");
          return manifest;
        }
        const nodes = manifest.nodes || {};
        if (selected.length === 1) {
          const layer = selected[0];
          const node = nodes[layer.id];
          const effectiveSemantic = node ? node.semantic : Psd2Ui.inferSourceSemantic(layer, false);
          const emptyGroup = Psd2Ui.collectUnconfiguredEmptyGroupIds(layer, manifest).has(String(layer.id));
          element("effective-semantic").textContent = emptyGroup ? "空组 · 未设置组件" : semanticDisplayName(effectiveSemantic);
          updateSelectionControls(selected, manifest, effectiveSemantic);
          if (emptyGroup) {
            element("layer-config-status").textContent = "没有可导出的内容，预检和导出自动跳过；添加内容后自动恢复正常导出。";
            setSemantic("", false);
          } else if (effectiveSemantic === "group" && (!node || node.authoringSource === "default")) {
            element("layer-config-status").textContent = "未设置组件；按普通图层组保留层级。需要改变用途时，选择类型后配置。";
            setSemantic("", false);
          } else if (node) {
            element("layer-config-status").textContent = node.authoringSource === "default" ? "自动识别。需要改变用途时，选择类型并保存。" : "已保存：".concat(semanticDisplayName(node.semantic)).concat(node.structure ? "，角色配置已记录" : "", "。");
            if (node.authoringSource === "default" && ["image", "raw-image"].includes(node.semantic)) {
              const bounds = layer.bounds || {};
              const width = Math.max(0, Number(bounds.right || 0) - Number(bounds.left || 0));
              const height = Math.max(0, Number(bounds.bottom || 0) - Number(bounds.top || 0));
              element("layer-config-status").textContent = "自动识别：".concat(width, " × ").concat(height, " px → ") + (node.semantic === "raw-image" ? "Texture（独立贴图）" : "Sprite（图片）") + "。选择类型并保存可固定用途。";
            }
            loadNodeIntoFields(node);
          } else {
            element("layer-config-status").textContent = "初始化后新增的图层；当前默认解析为 ".concat(semanticDisplayName(effectiveSemantic), "，导出时会补入配置。");
            setSemantic(effectiveSemantic, true);
          }
          const changes = Psd2Ui.diffLayerFromBaseline(manifest, layer);
          element("layer-change-summary").textContent = changes.length === 0 ? "与上次保存一致。" : "相对上次保存：".concat(changes.join("；"), "。");
        } else {
          const explicitCount = selected.filter((layer) => {
            const node = nodes[layer.id];
            return node && node.authoringSource !== "default";
          }).length;
          element("effective-semantic").textContent = "多选组合";
          updateSelectionControls(selected, manifest, element("semantic").value);
          element("layer-config-status").textContent = "已选择 ".concat(selected.length, " 个图层，其中 ").concat(explicitCount, " 个已有配置。选择连续同级图层可组合为组件。");
          const changed = selected.map((layer) => ({
            name: layer.name,
            changes: Psd2Ui.diffLayerFromBaseline(manifest, layer)
          })).filter((entry) => entry.changes.length > 0);
          element("layer-change-summary").textContent = changed.length === 0 ? "所选图层均与上次保存一致。" : "".concat(changed.length, " 个所选图层有变化：").concat(changed.slice(0, 3).map((entry) => "".concat(entry.name, "（").concat(entry.changes.join("、"), "）")).join("；")).concat(changed.length > 3 ? "；……" : "");
        }
        return manifest;
      }
      async function loadManifestIntoFields(requireExisting) {
        const manifest = await readManifest();
        if (!manifest) {
          if (requireExisting) throw new Error("当前 PSD 尚未初始化。");
          return null;
        }
        if (manifest.document) {
          element("document-name").value = manifest.document.name || "";
          element("document-submodule").value = manifest.document.submodule || "";
        }
        await refreshAuthoringState();
        return manifest;
      }
      function normalizeModuleInput() {
        const original = element("document-module").value;
        const normalized = String(original || "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").replace(/^[^a-z]+/, "");
        if (!normalized) throw new Error("当前输入无法规范为合法 module；请以小写英文字母开头。");
        element("document-module").value = normalized;
        moduleInputDirty = true;
        return { before: original, after: normalized };
      }
      function normalizeSubmoduleInput() {
        const original = element("document-submodule").value;
        const normalized = String(original || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^[^a-z]+/, "");
        if (!normalized) throw new Error("当前输入无法规范为合法 submodule；请以小写英文字母开头。");
        element("document-submodule").value = normalized;
        return { before: original, after: normalized };
      }
      async function inspectSelectedResource() {
        const manifest = await readManifest();
        if (!manifest) throw new Error("请先初始化当前 PSD 文档。");
        const layer = requireSingleSelection("读取资源绑定");
        const registry = manifest.resourceRegistry || {};
        const resourceId = (registry.layerBindings || {})[layer.id];
        const resource = resourceId && (registry.resources || {})[resourceId];
        if (!resource) {
          element("resource-summary").textContent = "".concat(layer.name, " 尚未显式绑定资源；默认导出时会自动分配。");
          return { layerId: layer.id, bound: false };
        }
        element("resource-summary").textContent = "".concat(resource.fileName, " · ").concat(resource.scope, " · ").concat(resource.status);
        element("reuse-resource-id").value = resourceId;
        return resource;
      }
      function prepareBundle(manifest, context) {
        const snapshot = createSnapshot(manifest.document.rootLayerId);
        const prepared = Psd2Ui.executeAuthoringCommand(manifest, {
          command: "prepare-default-export",
          input: { snapshot }
        }, context || HumanContext);
        return {
          snapshot,
          manifest: prepared.manifest,
          preparationDiagnostics: prepared.value.diagnostics,
          reconciliation: prepared.value.reconciliation,
          bundle: Psd2Ui.buildBundle(prepared.manifest, snapshot)
        };
      }
      function renderImageNameIssues(issues) {
        const container = element("image-name-issues");
        clearChildren(container);
        element("image-name-summary").textContent = issues.length ? "".concat(issues.length, " 处问题需要处理。点击问题可定位到 Photoshop 图层。") : "图片命名检查通过。";
        issues.forEach((issue, index) => {
          const row = document.createElement("div");
          row.className = "issue-row";
          const text = document.createElement("p");
          text.textContent = issue.message;
          row.appendChild(text);
          if (issue.layerId && issue.layerId !== "document-root") {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "text-action";
            button.textContent = "定位 ".concat(issue.name || issue.layerId);
            button.addEventListener("click", () => run("定位命名问题", () => selectLayersById([issue.layerId])));
            row.appendChild(button);
          }
          container.appendChild(row);
        });
      }
      function clearPreflightReport() {
        clearChildren(element("preflight-issues"));
        showElement("preflight-report", false);
      }
      function renderPreflightFailure(error) {
        let context = preflightContext;
        try {
          if (!context || context.documentKey !== documentKey()) context = null;
        } catch (readError) {
          context = null;
        }
        const rows = describePreflightIssues(error, context && context.manifest, context && context.snapshot);
        const container = element("preflight-issues");
        clearChildren(container);
        element("preflight-issue-summary").textContent = "发现 ".concat(rows.length, " 处问题，处理后重新预检。");
        element("export-summary").textContent = "预检未通过：".concat(rows.length, " 处问题。请查看上方问题列表。");
        rows.forEach((issue, index) => {
          const row = document.createElement("div");
          row.className = "preflight-issue";
          const heading = document.createElement("strong");
          heading.textContent = "".concat(index + 1, ". ").concat(issue.layers.length ? issue.layers.map((layer) => layer.name).join("、") : "文档 / 导出设置");
          row.appendChild(heading);
          issue.layers.forEach((layer) => {
            const path = document.createElement("p");
            path.className = "issue-layer-path";
            path.textContent = "".concat(layer.path, " · #").concat(layer.id);
            row.appendChild(path);
          });
          const reason = document.createElement("p");
          reason.textContent = issue.message;
          row.appendChild(reason);
          const hint = document.createElement("p");
          hint.className = "field-help";
          hint.textContent = issue.hint;
          row.appendChild(hint);
          issue.layers.filter((layer) => layer.canLocate && context).forEach((layer) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "text-action";
            button.textContent = "定位「".concat(layer.name, "」");
            const originKey = context.documentKey;
            button.addEventListener("click", () => run("定位预检问题", async () => {
              requireSameDocument(originKey);
              await selectLayersById([layer.id]);
              return { layerId: layer.id, layerName: layer.name, layerPath: layer.path };
            }));
            row.appendChild(button);
          });
          const code = document.createElement("p");
          code.className = "issue-code";
          code.textContent = issue.code;
          row.appendChild(code);
          container.appendChild(row);
        });
        showElement("preflight-report", true);
        PanelShell.activatePanel("export");
      }
      async function checkImageNames(requireValid) {
        const manifest = await ensureAuthoringManifest();
        const snapshot = createSnapshot(manifest.document.rootLayerId);
        const issues = Psd2Ui.collectInvalidImageLayerNames(snapshot, manifest);
        renderImageNameIssues(issues);
        if (requireValid && issues.length) {
          PanelShell.activatePanel("export");
          const error = new Error("图片命名检查未通过，共 ".concat(issues.length, " 处。请按检查列表修正后导出。"));
          error.issues = issues;
          throw error;
        }
        return { status: issues.length ? "blocked" : "ready", issues, manifest, snapshot };
      }
      async function prepareCurrentDocumentForExport() {
        clearPreflightReport();
        const context = { documentKey: documentKey(), manifest: null, snapshot: null };
        preflightContext = context;
        element("export-summary").textContent = "正在检查图层、组件和资源……";
        await restoreVisualStatePreview();
        const checked = await checkImageNames(false);
        requireSameDocument(context.documentKey);
        context.manifest = checked.manifest;
        context.snapshot = checked.snapshot;
        if (checked.issues.length) {
          const error = new Error("图片命名检查未通过，共 ".concat(checked.issues.length, " 处。"));
          error.issues = checked.issues;
          throw error;
        }
        const source = Psd2Ui.prepareSourceManifest(checked.manifest, checked.snapshot);
        context.manifest = source.manifest;
        const preflight = Psd2Ui.preflightBundle(source.manifest, checked.snapshot);
        if (preflight.status !== "ready") {
          const error = new Error("组件或资源预检未通过，共 ".concat(preflight.issues.length, " 处。"));
          error.issues = preflight.issues;
          throw error;
        }
        return prepareBundle(source.manifest);
      }
      function combineDiagnostics(...groups) {
        const result = [];
        const seen = /* @__PURE__ */ new Set();
        groups.forEach((group) => (group || []).forEach((entry) => {
          const key = [entry.severity, entry.code, entry.nodeId, entry.message].join("|");
          if (seen.has(key)) return;
          seen.add(key);
          result.push(entry);
        }));
        return result;
      }
      function normalizeNativePath(value) {
        return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
      }
      function requireExpectedDocumentPath(expectedDocumentPath) {
        const expected = String(expectedDocumentPath || "").trim();
        if (!expected) throw new Error("PS-MCP 写操作必须提供 expectedDocumentPath。");
        const info = getDocumentInfo();
        if (normalizeNativePath(info.path) !== normalizeNativePath(expected)) {
          throw new Error("当前 Photoshop 文档不是预期目标。预期：".concat(expected, "；实际：").concat(info.path));
        }
        return info;
      }
      function summarizeLayer(layer) {
        const bounds = layer && layer.bounds;
        const number = (value) => {
          const parsed = Number(value && value.value != null ? value.value : value);
          return Number.isFinite(parsed) ? parsed : 0;
        };
        return {
          id: String(layer.id),
          name: String(layer.name || ""),
          kind: String(layer.kind || ""),
          visible: layer.visible !== false,
          childCount: layer.layers ? layer.layers.length : 0,
          bounds: bounds ? {
            left: number(bounds.left),
            top: number(bounds.top),
            right: number(bounds.right),
            bottom: number(bounds.bottom)
          } : null
        };
      }
      async function inspectForAutomation(options) {
        const key = documentKey();
        const document2 = requireDocument();
        const documentInfo = options && options.expectedDocumentPath ? requireExpectedDocumentPath(options.expectedDocumentPath) : getDocumentInfo();
        const manifest = await readManifest();
        const sidecar = await readSidecarManifest(document2);
        requireSameDocument(key);
        let activeLayers = [];
        try {
          activeLayers = getActiveLayersInfo().map((entry) => summarizeLayer(entry.layer));
        } catch (error) {
          activeLayers = [];
        }
        return {
          document: documentInfo,
          activeLayers,
          topLevelLayers: Array.from(document2.layers || []).map(summarizeLayer),
          manifest: manifest ? __spreadProps(__spreadValues({}, manifest), {
            nodeCount: Object.keys(manifest.nodes || {}).length,
            resourceCount: Object.keys(
              manifest.resourceRegistry && manifest.resourceRegistry.resources || {}
            ).length
          }) : null,
          sidecar: { path: sidecar.path, exists: Boolean(sidecar.manifest) },
          exportSettings: {
            uiResPath: currentUiResFolder && currentUiResFolder.nativePath || null,
            source: "loaded-plugin-preference",
            scope: "global"
          }
        };
      }
      async function initializeForAutomation(options) {
        const input = options || {};
        const documentInfo = requireExpectedDocumentPath(input.expectedDocumentPath);
        const existingManifest = await readManifest();
        if (existingManifest && input.allowReinitialize !== true) {
          throw new Error("当前 PSD 已经初始化；如需覆盖必须显式提供 allowReinitialize=true。");
        }
        const rootLayerId = String(input.rootLayerId || "document-root").trim();
        const document2 = requireDocument();
        const root = rootLayerId === "document-root" ? { name: documentInfo.name } : findLayerById(document2.layers || [], rootLayerId);
        if (!root) throw new Error("当前 PSD 中找不到初始化根图层 ".concat(rootLayerId || "<empty>", "。"));
        const snapshot = createSnapshot(rootLayerId);
        const result = await executeWithContext("initialize-document", {
          resourceNaming: "source",
          module: input.module,
          submodule: input.submodule,
          name: input.name || documentInfo.name,
          width: documentInfo.width,
          height: documentInfo.height,
          rootLayerId,
          rootLayerName: String(root.name || input.name || documentInfo.name),
          snapshot
        }, McpContext);
        return {
          document: result.value,
          initializedNodeCount: Object.keys(result.manifest.nodes || {}).length,
          sidecarPath: result.writeResult.sidecarPath
        };
      }
      async function executeForAutomation(options) {
        const input = options || {};
        requireExpectedDocumentPath(input.expectedDocumentPath);
        if (!["set-visual-states", "set-collection-previews", "set-node-viewport"].includes(input.command)) {
          return executeWithContext(input.command, input.input || {}, McpContext);
        }
        const key = documentKey();
        const current = await readManifest();
        requireSameDocument(key);
        if (!current) throw new Error("请先初始化当前 PSD 文档。");
        const commandInput = __spreadValues({}, input.input || {});
        const snapshot = createSnapshot(current.document.rootLayerId);
        const root = withAuthoringState([snapshot.root], current)[0];
        const target = findSnapshotLayer([root], commandInput.layerId);
        if (!target) throw new Error("当前配置根内找不到图层 ".concat(commandInput.layerId || "<empty>", "。"));
        if (input.command === "set-visual-states") {
          if (!Psd2Ui.isGroupLayer(target)) throw new Error("视觉状态只能配置在 Photoshop 组上。");
          if (!Object.prototype.hasOwnProperty.call(commandInput, "visualStates")) {
            throw new Error("必须提供 visualStates；清除配置时显式传 null。");
          }
          commandInput.visualStates = commandInput.visualStates === null ? null : Psd2Ui.planVisualStates(target, commandInput.visualStates);
        } else if (input.command === "set-collection-previews") {
          commandInput.snapshot = snapshot;
        } else {
          if (!Object.prototype.hasOwnProperty.call(commandInput, "viewport")) {
            throw new Error("必须提供 viewport；清除配置时显式传 null。");
          }
          commandInput.sourceBounds = target.bounds;
        }
        const result = Psd2Ui.executeAuthoringCommand(current, {
          command: input.command,
          input: commandInput
        }, McpContext);
        const checked = Psd2Ui.prepareManifestForExport(result.manifest, snapshot, { allocateResources: false });
        const targetId = checked.manifest.nodes[String(commandInput.layerId)].id;
        const issues = checked.diagnostics.filter((entry) => entry.severity === "error" && entry.nodeId === targetId && /^PSD2UI_(VISUAL_STATE|VIEWPORT)/.test(entry.code));
        if (issues.length) {
          const error = new Error("当前图层配置不可用；本次尚未保存。");
          error.issues = issues;
          throw error;
        }
        requireSameDocument(key);
        const persisted = await persistManifest(result.manifest, null, McpContext);
        return {
          manifest: persisted.manifest,
          value: persisted.manifest.nodes[String(commandInput.layerId)],
          writeResult: persisted.writeResult
        };
      }
      async function applyConfirmedPreinitializeRenamesForAutomation(options) {
        const input = options || {};
        requireExpectedDocumentPath(input.expectedDocumentPath);
        if (input.confirmationText !== "APPLY_CONFIRMED_PREINITIALIZE_RENAMES") {
          throw new Error("初始化前重命名计划缺少当前用户确认标记。");
        }
        const plan = input.plan;
        const confirmationId = String(plan && plan.confirmationId || "").trim();
        if (!confirmationId || confirmationId !== String(input.confirmationId || "").trim()) {
          throw new Error("初始化前重命名计划 confirmationId 与调用确认不一致。");
        }
        const current = await readManifest();
        const repairPreservedState = input.repairPreservedState === true;
        if (current && !repairPreservedState) {
          throw new Error("当前 PSD 已经初始化，不允许再执行初始化前重命名。");
        }
        if (!current && repairPreservedState) {
          throw new Error("当前 PSD 尚未初始化，不需要执行初始化前状态恢复。");
        }
        return applyConfirmedPreinitializeRenames(plan, input.rootLayerId, {
          repairPreservedState
        });
      }
      function assertNoNewStructuralEditIssues(baseline, prepared, edits) {
        const structuralErrors = (diagnostics) => (diagnostics || []).filter((entry) => entry.severity === "error" && /^PSD2UI_(STRUCTURE|VISUAL_STATE|VIEWPORT)/.test(entry.code));
        const issueKey = (entry) => JSON.stringify([entry.code || "", entry.nodeId || "", entry.message || ""]);
        const existing = new Set(structuralErrors(baseline.diagnostics).map(issueKey));
        const issues = structuralErrors(prepared.diagnostics).filter((entry) => !existing.has(issueKey(entry)));
        const deletedIds = /* @__PURE__ */ new Set();
        (edits || []).filter((entry) => entry.operation === "delete").forEach((entry) => {
          [entry.layerId, ...entry.descendantIds || []].forEach((id) => deletedIds.add(String(id)));
        });
        Object.keys(baseline.manifest.nodes || {}).forEach((layerId) => {
          const before = baseline.manifest.nodes[layerId];
          if (!before.structure && !before.visualStates && !before.viewport) return;
          const after = prepared.manifest.nodes[layerId];
          if (!after) {
            if (!deletedIds.has(String(layerId))) issues.push({
              severity: "error",
              code: "PSD2UI_STRUCTURE_OWNER_REMOVED",
              nodeId: before.id || "",
              message: "组件 '".concat(before.name || layerId, "' 的配置根已消失或移出当前导出根，但计划没有删除该组件。")
            });
            return;
          }
          const previews = new Set((after.structure && after.structure.previewLayerIds || []).map(String));
          (before.structure && before.structure.previewLayerIds || []).forEach((id) => {
            if (!previews.has(String(id))) issues.push({
              severity: "error",
              code: "PSD2UI_STRUCTURE_PREVIEW_REMOVED",
              nodeId: before.id || "",
              message: "组件 '".concat(before.name || layerId, "' 的仅预览引用图层 ").concat(id, " 被本次结构操作移除。")
            });
          });
        });
        if (issues.length) {
          const error = new Error("结构操作新增了组件引用或布局错误，已停止保存并请求恢复图层树。");
          error.code = "PSD2UI_STRUCTURE_EDIT_INVALID";
          error.issues = issues;
          throw error;
        }
      }
      async function applyConfirmedStructurePlanForAutomation(options) {
        const input = options || {};
        requireExpectedDocumentPath(input.expectedDocumentPath);
        if (input.confirmationText !== "APPLY_CONFIRMED_STRUCTURE_PLAN") {
          throw new Error("结构计划缺少当前用户确认标记。");
        }
        const plan = input.plan;
        const confirmationId = String(plan && plan.confirmationId || "").trim();
        if (!confirmationId || confirmationId !== String(input.confirmationId || "").trim()) {
          throw new Error("结构计划 confirmationId 与调用确认不一致。");
        }
        const current = await readManifest();
        if (!current) throw new Error("请先初始化当前 PSD 文档。");
        const context = { actor: "human-approved-plan", confirmationId };
        const hasEdits = ["moves", "ungroups", "deletes"].some((key) => Array.isArray(plan[key]) && plan[key].length);
        const baseline = hasEdits ? Psd2Ui.prepareManifestForExport(
          current,
          createSnapshot(current.document.rootLayerId),
          { allocateResources: false }
        ) : null;
        return runDocumentMutationWithManifestRollback(current, (persistInMutation) => applyConfirmedStructurePlan(plan, async (applied) => {
          const snapshot = createSnapshot(current.document.rootLayerId);
          let prepared = Psd2Ui.prepareManifestForExport(baseline ? baseline.manifest : current, snapshot, {
            allocateResources: false
          });
          let manifest = prepared.manifest;
          for (const container of applied.containers) {
            manifest = Psd2Ui.executeAuthoringCommand(manifest, {
              command: "apply-node-preset",
              input: { layerId: container.layerId, name: container.name, semantic: "group" }
            }, McpContext).manifest;
          }
          for (const structured of applied.structured) {
            manifest = Psd2Ui.executeAuthoringCommand(manifest, {
              command: "apply-structured-group",
              input: structured
            }, context).manifest;
          }
          for (const preset of applied.presets) {
            manifest = Psd2Ui.executeAuthoringCommand(manifest, {
              command: "apply-node-preset",
              input: preset
            }, McpContext).manifest;
          }
          manifest = Psd2Ui.prepareManifestForExport(manifest, snapshot, {
            allocateResources: false
          }).manifest;
          for (const copy of applied.copies) {
            const registry = manifest.resourceRegistry || {};
            const sourceResourceId = (registry.layerBindings || {})[copy.sourceLayerId];
            if (!sourceResourceId) {
              throw new Error("复制图层 ".concat(copy.layerId, " 的来源 ").concat(copy.sourceLayerId, " 没有可复用资源。"));
            }
            manifest = Psd2Ui.executeAuthoringCommand(manifest, {
              command: "reuse-resource",
              input: { layerId: copy.layerId, resourceId: sourceResourceId }
            }, McpContext).manifest;
          }
          prepared = Psd2Ui.prepareManifestForExport(manifest, snapshot);
          if (baseline) assertNoNewStructuralEditIssues(baseline, prepared, applied.edits);
          const persisted = await persistInMutation(prepared.manifest, context);
          return {
            confirmationId,
            copies: applied.copies,
            edits: applied.edits || [],
            containers: applied.containers,
            structured: applied.structured.map((entry) => ({
              layerId: entry.layerId,
              name: entry.name,
              semantic: entry.semantic,
              roles: entry.structure.roles
            })),
            presets: applied.presets,
            nodeCount: Object.keys(persisted.manifest.nodes || {}).length,
            resourceCount: Object.keys(
              persisted.manifest.resourceRegistry && persisted.manifest.resourceRegistry.resources || {}
            ).length,
            diagnostics: combineDiagnostics(prepared.diagnostics, persisted.diagnostics),
            reconciliation: persisted.reconciliation,
            sidecarPath: persisted.writeResult.sidecarPath
          };
        }));
      }
      function canonicalJson(value) {
        if (Array.isArray(value)) return value.map(canonicalJson);
        if (!value || typeof value !== "object") return value;
        return Object.keys(value).sort().reduce((result, key) => {
          result[key] = canonicalJson(value[key]);
          return result;
        }, {});
      }
      function assertJsonEqual(actual, expected, label) {
        if (JSON.stringify(canonicalJson(actual)) !== JSON.stringify(canonicalJson(expected))) {
          throw new Error("".concat(label, "不一致，已停止迁移。"));
        }
      }
      function assertScalarEqual(actual, expected, label) {
        if (String(actual) !== String(expected)) {
          throw new Error("".concat(label, "不一致；计划为 '").concat(expected, "'，当前为 '").concat(actual, "'。"));
        }
      }
      function localActiveResources(manifest) {
        const moduleName = manifest && manifest.document && manifest.document.module;
        return Object.values(manifest && manifest.resourceRegistry && manifest.resourceRegistry.resources || {}).filter((resource) => resource && resource.status === "active" && resource.module === moduleName && resource.scope === "module");
      }
      function validateConfirmedSubmoduleMigrationPlan(manifest, sidecarManifest, plan) {
        if (!plan || plan.version !== 1 || typeof plan !== "object") {
          throw new Error("submodule 迁移计划必须是 version=1 的对象。");
        }
        const expected = plan.expected;
        if (!expected || typeof expected !== "object") {
          throw new Error("submodule 迁移计划缺少 expected 前置条件。");
        }
        const targetSubmodule = String(plan.submodule || "").trim();
        if (!targetSubmodule) throw new Error("submodule 迁移计划缺少目标 submodule。");
        if (!manifest) throw new Error("当前 PSD 尚未初始化，不能执行 submodule 迁移。");
        if (!sidecarManifest) throw new Error("当前 PSD 缺少同目录配置镜像，不能执行事务迁移。");
        assertJsonEqual(sidecarManifest, manifest, "PSD XMP 与同目录配置镜像");
        Psd2Ui.assertManifestValid(manifest);
        assertScalarEqual(manifest.manifestVersion, expected.manifestVersion, "manifestVersion");
        assertScalarEqual(manifest.revision, expected.revision, "revision");
        assertScalarEqual(manifest.document.id, expected.documentId, "document.id");
        assertScalarEqual(manifest.document.name, expected.documentName, "document.name");
        assertScalarEqual(manifest.document.module, expected.module, "document.module");
        assertScalarEqual(manifest.document.rootLayerId, expected.rootLayerId, "document.rootLayerId");
        if (manifest.document.submodule != null) {
          throw new Error("当前 PSD 已有 submodule '".concat(manifest.document.submodule, "'，不能重复执行一次性迁移。"));
        }
        const resources = Object.values(manifest.resourceRegistry.resources || {});
        const active = resources.filter((resource) => resource && resource.status === "active");
        const local = localActiveResources(manifest);
        assertScalarEqual(Object.keys(manifest.nodes || {}).length, expected.nodeCount, "nodeCount");
        assertScalarEqual(resources.length, expected.resourceCount, "resourceCount");
        assertScalarEqual(active.length, expected.activeResourceCount, "activeResourceCount");
        if (active.length !== local.length) {
          throw new Error("当前 PSD 存在 Common、跨模块或非 module scope 的活动资源，不能执行文档级 submodule 迁移。");
        }
        assertJsonEqual(manifest.resourceRegistry.counters || {}, expected.counters || {}, "资源计数器前置条件");
        return { expected, targetSubmodule, resources, active };
      }
      function migrationInvariant(manifest, targetSubmodule) {
        const snapshot = JSON.parse(JSON.stringify(manifest));
        const moduleName = snapshot.document.module;
        delete snapshot.manifestVersion;
        delete snapshot.revision;
        delete snapshot.document.submodule;
        Object.values(snapshot.resourceRegistry.resources || {}).forEach((resource) => {
          if (!resource || resource.status !== "active" || resource.module !== moduleName || resource.scope !== "module") return;
          delete resource.submodule;
          delete resource.fileName;
          delete resource.history;
        });
        Object.keys(snapshot.resourceRegistry.counters || {}).forEach((key) => {
          if (key.startsWith("".concat(moduleName, "|").concat(targetSubmodule, "|"))) {
            delete snapshot.resourceRegistry.counters[key];
          }
        });
        return snapshot;
      }
      function assertConfirmedSubmoduleMigrationResult(before, after, planState) {
        const { targetSubmodule } = planState;
        const moduleName = before.document.module;
        assertScalarEqual(after.manifestVersion, "1.1.0", "迁移后的 manifestVersion");
        assertScalarEqual(after.revision, Number(before.revision) + 1, "迁移后的 revision");
        assertScalarEqual(after.document.submodule, targetSubmodule, "迁移后的 document.submodule");
        assertJsonEqual(
          migrationInvariant(after, targetSubmodule),
          migrationInvariant(before, targetSubmodule),
          "submodule 迁移白名单之外的 Manifest 内容"
        );
        const beforeResources = before.resourceRegistry.resources || {};
        const afterResources = after.resourceRegistry.resources || {};
        const migrated = localActiveResources(before);
        migrated.forEach((resource) => {
          const current = afterResources[resource.id];
          if (!current) throw new Error("迁移后丢失资源 ".concat(resource.id, "。"));
          assertScalarEqual(current.submodule, targetSubmodule, "资源 ".concat(resource.id, ".submodule"));
          const marker = resource.kind === "sprite" ? "sp" : "tex";
          const expectedFileName = "".concat(moduleName, "_").concat(targetSubmodule, "_").concat(marker, "_").concat(String(resource.number).padStart(4, "0"), ".png");
          assertScalarEqual(current.fileName, expectedFileName, "资源 ".concat(resource.id, ".fileName"));
          const previousHistory = Array.isArray(resource.history) ? resource.history : [];
          const currentHistory = Array.isArray(current.history) ? current.history : [];
          if (currentHistory.length !== previousHistory.length + 1) {
            throw new Error("资源 ".concat(resource.id, ".history 没有只追加一条迁移记录。"));
          }
          assertJsonEqual(
            currentHistory.slice(0, previousHistory.length),
            previousHistory,
            "资源 ".concat(resource.id, ".history 既有记录")
          );
          const appended = currentHistory[currentHistory.length - 1];
          assertJsonEqual(appended, {
            module: resource.module,
            kind: resource.kind,
            number: resource.number,
            fileName: resource.fileName,
            reason: "confirmed-document-submodule-migration"
          }, "资源 ".concat(resource.id, ".history 新迁移记录"));
        });
        const expectedCounters = __spreadValues({}, before.resourceRegistry.counters || {});
        ["sprite", "texture"].forEach((kind) => {
          const numbers = Object.values(beforeResources).filter((resource) => resource && resource.module === moduleName && resource.kind === kind && Number.isInteger(resource.number)).map((resource) => resource.number);
          if (numbers.length === 0) return;
          const legacyKey = "".concat(moduleName, "|").concat(kind);
          const namespacedKey = "".concat(moduleName, "|").concat(targetSubmodule, "|").concat(kind);
          const legacyNext = Number.isInteger(expectedCounters[legacyKey]) ? expectedCounters[legacyKey] : 1;
          expectedCounters[namespacedKey] = Math.max(legacyNext, Math.max(...numbers) + 1);
        });
        assertJsonEqual(after.resourceRegistry.counters || {}, expectedCounters, "迁移后的资源计数器");
      }
      async function assertPersistedManifest(expectedManifest, document2, phase) {
        const xmpManifest = await readManifest();
        const sidecar = await readSidecarManifest(document2);
        if (!sidecar.manifest) throw new Error("".concat(phase, "同目录配置镜像不可读。"));
        assertJsonEqual(xmpManifest, expectedManifest, "".concat(phase, "PSD XMP"));
        assertJsonEqual(sidecar.manifest, expectedManifest, "".concat(phase, "同目录配置镜像"));
      }
      async function applyConfirmedSubmoduleMigrationForAutomation(options) {
        const input = options || {};
        requireExpectedDocumentPath(input.expectedDocumentPath);
        if (input.confirmationText !== "APPLY_CONFIRMED_SUBMODULE_MIGRATION") {
          throw new Error("submodule 迁移计划缺少当前用户确认标记。");
        }
        const plan = input.plan;
        const confirmationId = String(plan && plan.confirmationId || "").trim();
        if (!confirmationId || confirmationId !== String(input.confirmationId || "").trim()) {
          throw new Error("submodule 迁移计划 confirmationId 与调用确认不一致。");
        }
        const document2 = requireDocument();
        const originalXmp = await getDocumentXmp();
        const originalSidecar = await readSidecarRaw(document2);
        const current = await readManifest();
        const sidecar = await readSidecarManifest(document2);
        if (await getDocumentXmp() !== originalXmp) {
          throw new Error("读取迁移前置条件时 PSD XMP 发生变化，请重试。");
        }
        const planState = validateConfirmedSubmoduleMigrationPlan(current, sidecar.manifest, plan);
        const context = { actor: "human-approved-plan", confirmationId };
        const result = Psd2Ui.executeAuthoringCommand(current, {
          command: "set-document-submodule",
          input: {
            submodule: planState.targetSubmodule,
            reason: "confirmed-document-submodule-migration"
          }
        }, context);
        assertConfirmedSubmoduleMigrationResult(current, result.manifest, planState);
        return photoshopCore.executeAsModal(async (executionContext) => {
          const suspension = await executionContext.hostControl.suspendHistory({
            documentID: document2.id,
            name: "PSD2UI：迁移 submodule ".concat(planState.targetSubmodule)
          });
          let historyOpen = true;
          try {
            const writeResult = await writeManifestInCurrentModal(result.manifest, false);
            await assertPersistedManifest(result.manifest, document2, "保存前");
            await document2.save();
            await assertPersistedManifest(result.manifest, document2, "保存后");
            await executionContext.hostControl.resumeHistory(suspension, true);
            historyOpen = false;
            return {
              confirmationId,
              documentId: result.manifest.document.id,
              module: result.manifest.document.module,
              submodule: result.manifest.document.submodule,
              revision: result.manifest.revision,
              migratedResourceCount: result.value.migratedResources.length,
              sidecarPath: writeResult.sidecarPath
            };
          } catch (error) {
            const rollbackErrors = [];
            if (historyOpen) {
              try {
                await executionContext.hostControl.resumeHistory(suspension, false);
                historyOpen = false;
              } catch (rollbackError) {
                rollbackErrors.push("Photoshop History：".concat(formatError(rollbackError)));
              }
            }
            try {
              await setDocumentXmp(originalXmp);
            } catch (rollbackError) {
              rollbackErrors.push("PSD XMP：".concat(formatError(rollbackError)));
            }
            try {
              await restoreSidecarRaw(originalSidecar);
            } catch (rollbackError) {
              rollbackErrors.push("同目录配置镜像：".concat(formatError(rollbackError)));
            }
            try {
              await document2.save();
            } catch (rollbackError) {
              rollbackErrors.push("PSD 保存：".concat(formatError(rollbackError)));
            }
            try {
              if (await getDocumentXmp() !== originalXmp) {
                throw new Error("恢复后的原始 XMP 字节不一致。");
              }
              const restoredSidecar = await readSidecarRaw(document2);
              assertJsonEqual(restoredSidecar, originalSidecar, "恢复后的同目录配置镜像");
              await assertPersistedManifest(current, document2, "回滚后");
            } catch (rollbackError) {
              rollbackErrors.push("回滚读回：".concat(formatError(rollbackError)));
            }
            if (rollbackErrors.length > 0) {
              throw new Error("".concat(formatError(error), "\n事务回滚失败：").concat(rollbackErrors.join("；")));
            }
            throw error;
          }
        }, { commandName: "PSD2UI：迁移 submodule ".concat(planState.targetSubmodule) });
      }
      async function preflightForAutomation(options) {
        requireExpectedDocumentPath(options && options.expectedDocumentPath);
        const prepared = await prepareCurrentDocumentForExport();
        return {
          document: prepared.bundle.document,
          diagnostics: combineDiagnostics(
            prepared.preparationDiagnostics,
            prepared.bundle.diagnostics
          ),
          reconciliation: prepared.reconciliation,
          resources: prepared.bundle.resources.map((resource) => ({
            fileName: resource.fileName,
            sourceLayerId: resource.sourceLayerId,
            sliceBorder: resource.sliceBorder || null
          }))
        };
      }
      async function exportForAutomation(options) {
        const input = options || {};
        requireExpectedDocumentPath(input.expectedDocumentPath);
        if (!String(input.uiResPath || "").trim()) {
          throw new Error("PS-MCP 导出必须显式提供已授权的 UIRes 路径。");
        }
        const prepared = await prepareCurrentDocumentForExport();
        const persisted = await persistManifest(prepared.manifest, null, McpContext);
        const result = await writeBundle(prepared.bundle, { uiResPath: input.uiResPath });
        return __spreadProps(__spreadValues({}, result), {
          diagnostics: combineDiagnostics(
            prepared.preparationDiagnostics,
            prepared.bundle.diagnostics
          ),
          reconciliation: prepared.reconciliation,
          sidecarPath: persisted.writeResult.sidecarPath
        });
      }
      function installDeveloperAutomation() {
        const automation = Object.freeze({
          openDocument: async (options) => openLocalDocument(options && options.documentPath),
          inspect: inspectForAutomation,
          wrapDocumentRoot: async (options) => {
            const input = options || {};
            requireExpectedDocumentPath(input.expectedDocumentPath);
            return wrapTopLevelLayersInGroup(input.layerIds, input.groupName);
          },
          snapshot: async (options) => {
            requireExpectedDocumentPath(options && options.expectedDocumentPath);
            return createSnapshot(options && options.rootLayerId);
          },
          initialize: initializeForAutomation,
          applyConfirmedPreinitializeRenames: applyConfirmedPreinitializeRenamesForAutomation,
          applyConfirmedStructurePlan: applyConfirmedStructurePlanForAutomation,
          applyConfirmedSubmoduleMigration: applyConfirmedSubmoduleMigrationForAutomation,
          execute: executeForAutomation,
          preflight: preflightForAutomation,
          exportBundle: exportForAutomation
        });
        globalThis.__PSD2UI_DEV__ = automation;
        globalThis.__YOYO_PSD2UI_DEV__ = automation;
        globalThis.__PSD2UI_BUSY__ = () => operationRunning;
        globalThis.__PSD2UI_RUN__ = async (label, callback) => {
          if (operationRunning) throw new Error("PSD2UI 正在执行其他操作，请等待完成。");
          operationRunning = true;
          authoringRefreshVersion += 1;
          try {
            return await callback();
          } finally {
            operationRunning = false;
          }
        };
      }
      element("clear-status").addEventListener("click", () => writeStatus("等待操作。"));
      PanelShell.setPanelChangeHandler(handlePanelChanged);
      element("semantic").addEventListener("change", () => {
        const semantic = element("semantic").value;
        setSemantic(semantic, true);
        renderComponentEditor(true);
        writeStatus("已切换到 ".concat(semantic, "；不会修改 Photoshop 图层名。"), "已切换组件类型");
      });
      element("reset-image-defaults").addEventListener("click", () => {
        resetImageDefaults();
        writeStatus("图片参数已恢复默认值；尚未写入 PSD。", "已恢复图片默认值");
      });
      element("reset-text-defaults").addEventListener("click", () => {
        resetTextDefaults();
        writeStatus("fontKey 已恢复为 default；尚未写入 PSD。", "已恢复文本默认值");
      });
      element("refresh-context").addEventListener("click", () => run("刷新当前状态", refreshAuthoringState));
      element("prepare-document").addEventListener("click", () => run("准备 PSD", prepareDocument));
      element("wrap-document-root").addEventListener("click", () => run("建立根组", wrapDocumentRoot));
      element("start-components").addEventListener("click", () => PanelShell.activatePanel("layer"));
      element("go-prepare").addEventListener("click", () => PanelShell.activatePanel("prepare"));
      element("return-to-component").addEventListener("click", async () => {
        if (!returnComponent || operationRunning) return;
        const target = returnComponent;
        const result = await run("返回组件", async () => {
          requireSameDocument(target.documentKey);
          await selectLayersById(target.layerIds);
          return { restored: true };
        });
        if (!result) return;
        if (selectionRefreshTimer != null) clearTimeout(selectionRefreshTimer);
        selectionRefreshTimer = null;
        selectionRefreshQueued = false;
        await refreshAuthoringState();
        setSemantic(target.semantic, false);
        renderComponentEditor(false);
        componentOptions = target.options;
        renderComponentEditor(true);
        returnComponent = null;
        showElement("return-to-component", false);
        writeStatus("已恢复刚才的角色选择；请点击保存组件配置。", "已返回组件，角色选择待保存");
      });
      element("sync-layer-tree").addEventListener("click", () => run("同步图层树到配置", syncLayerTreeToManifest));
      element("read-document-name").addEventListener("click", () => run("读取界面名称", async () => {
        const info = getDocumentInfo();
        element("document-name").value = info.name;
        return { name: info.name, source: "PSD 文件名" };
      }));
      element("use-layer-name").addEventListener("click", () => run("读取选中图层名", async () => {
        const layer = requireSingleSelection("读取选中图层名");
        element("document-name").value = layer.name;
        return { name: layer.name, source: "选中图层" };
      }));
      element("clear-document-name").addEventListener("click", () => {
        element("document-name").value = "";
        writeStatus("界面名称已清空；尚未写入 PSD。", "已清空界面名称");
      });
      element("select-uires").addEventListener("click", () => run("选择输出目录", async () => {
        const folder = await chooseUiResFolder();
        renderUiResFolder(folder);
        return { uiResPath: folder.nativePath };
      }));
      element("clear-uires").addEventListener("click", () => run("清除输出目录", async () => {
        clearRememberedUiResFolder();
        renderUiResFolder(null, "已清除；下次导出前必须重新选择目录。");
        return { cleared: true };
      }));
      element("document-module").addEventListener("input", () => {
        moduleInputDirty = true;
      });
      element("normalize-module").addEventListener("click", () => run("规范模块名称", async () => normalizeModuleInput()));
      element("normalize-submodule").addEventListener("click", () => run("规范 submodule", async () => normalizeSubmoduleInput()));
      element("load-manifest").addEventListener("click", () => run("读取 PSD Manifest", async () => loadManifestIntoFields(true)));
      element("initialize-document").addEventListener("click", () => run("初始化文档", async () => {
        if (await readManifest()) return prepareDocument();
        const documentInfo = getDocumentInfo();
        const root = requireSingleSelection("初始化文档根组");
        const snapshot = createSnapshot(root.id);
        const result = await execute("initialize-document", {
          resourceNaming: "source",
          module: element("document-module").value || "document",
          submodule: element("document-submodule").value,
          name: element("document-name").value || documentInfo.name,
          width: documentInfo.width,
          height: documentInfo.height,
          rootLayerId: root.id,
          rootLayerName: root.name,
          snapshot
        });
        await loadManifestIntoFields(true);
        const initializedNodes = result.manifest.nodes || {};
        const defaultSemanticCount = Object.keys(initializedNodes).filter((layerId) => initializedNodes[layerId] && initializedNodes[layerId].authoringSource === "default").length;
        return {
          document: result.value,
          initializedNodeCount: Object.keys(initializedNodes).length,
          defaultSemanticCount,
          sidecarPath: result.writeResult.sidecarPath
        };
      }));
      element("set-module").addEventListener("click", () => run("保存界面所属模块", saveDocumentModule));
      element("set-submodule").addEventListener("click", () => run("更新 submodule", async () => {
        const manifest = await readManifest();
        if (!manifest) throw new Error("请先初始化当前 PSD 文档。");
        const activeResourceCount = Object.values(manifest.resourceRegistry && manifest.resourceRegistry.resources || {}).filter((resource) => resource && resource.status === "active").length;
        if (activeResourceCount > 0) {
          throw new Error("当前 PSD 已有活动资源；请使用带精确前置条件和补偿回滚的已确认 submodule 迁移计划。");
        }
        const result = await execute("set-document-submodule", {
          submodule: element("document-submodule").value,
          reason: "human-panel-document-submodule-migration"
        });
        await loadManifestIntoFields(true);
        return result.value;
      }));
      element("apply-preset").addEventListener("click", () => run("写入组件语义", applySelectedPreset));
      element("structure-component").addEventListener("click", () => run("结构化当前组", structureSelectedComponent));
      element("combine-component").addEventListener("click", () => run("组合为组件", combineSelectedComponent));
      element("component-group-name").addEventListener("change", validateComponentDraft);
      element("recalculate-component-layout").addEventListener("click", recalculateComponentLayout);
      element("locate-selection-issue").addEventListener("click", () => run("定位组合问题", () => selectLayersById(selectionIssueLayerIds)));
      element("image-type").addEventListener("change", updateSemanticOptions);
      element("add-visual-state").addEventListener("click", () => {
        addVisualStateRow(null, visualStateInputs.length === 0);
        validateVisualStateDraft();
      });
      element("save-visual-states").addEventListener("click", () => run("保存视觉状态", saveVisualStates));
      element("preview-visual-state").addEventListener("click", () => run("预览视觉状态", async () => {
        const value = Psd2Ui.planVisualStates(componentSelection[0], readVisualStates());
        return previewVisualState(value, element("visual-state-preview-choice").value);
      }, { keepVisualPreview: true }));
      element("restore-visual-state").addEventListener("click", () => run("恢复原可见性", restoreVisualStatePreview, { keepVisualPreview: true }));
      element("batch-rename-selection").addEventListener("click", () => run("批量重命名所选图层", batchRenameSelectedLayers));
      element("inspect-resource").addEventListener("click", () => run("读取资源绑定", inspectSelectedResource));
      element("allocate-resource").addEventListener("click", () => run("分配组件资源", async () => {
        const manifest = await readManifest();
        if (!manifest) throw new Error("请先初始化当前 PSD 文档。");
        const layer = requireSingleSelection("分配组件资源");
        const node = manifest.nodes && manifest.nodes[layer.id];
        if (!node || node.semantic !== "image" && node.semantic !== "raw-image") {
          throw new Error("选中图层必须先写入 Image 或 Raw Image 语义。");
        }
        const result = await execute("allocate-resource", {
          layerId: layer.id,
          kind: node.semantic === "raw-image" ? "texture" : "sprite"
        });
        await inspectSelectedResource();
        return result.value;
      }));
      element("reuse-resource").addEventListener("click", () => run("复用资源", async () => {
        const layer = requireSingleSelection("复用资源");
        const result = await execute("reuse-resource", {
          layerId: layer.id,
          resourceId: element("reuse-resource-id").value
        });
        await inspectSelectedResource();
        return result.value;
      }));
      element("promote-common").addEventListener("click", () => run("人工提升为 Common", async () => {
        const manifest = await readManifest();
        if (!manifest) throw new Error("请先初始化当前 PSD 文档。");
        const layer = requireSingleSelection("提升 Common 资源");
        const resourceId = manifest.resourceRegistry.layerBindings[layer.id];
        if (!resourceId) throw new Error("选中图层尚未绑定资源。");
        const resource = manifest.resourceRegistry.resources[resourceId];
        const submodule = String(element("migration-submodule").value || "").trim();
        if (manifest.document.submodule && !submodule) {
          throw new Error("提升为 Common 时必须填写 Common 下的目标 submodule。");
        }
        const result = await execute("promote-resource-to-common", {
          resourceId,
          submodule,
          kind: resource.kind
        });
        await inspectSelectedResource();
        return result.value;
      }));
      element("migrate-resource").addEventListener("click", () => run("人工迁移资源", async () => {
        const manifest = await readManifest();
        if (!manifest) throw new Error("请先初始化当前 PSD 文档。");
        const layer = requireSingleSelection("迁移资源");
        const resourceId = manifest.resourceRegistry.layerBindings[layer.id];
        if (!resourceId) throw new Error("选中图层尚未绑定资源。");
        const result = await execute("migrate-resource", {
          resourceId,
          module: element("migration-module").value,
          submodule: element("migration-submodule").value,
          kind: element("migration-kind").value,
          reason: "human-panel-explicit-migration"
        });
        await inspectSelectedResource();
        return result.value;
      }));
      element("retire-resource").addEventListener("click", () => run("停用当前资源", async () => {
        const manifest = await readManifest();
        if (!manifest) throw new Error("请先初始化当前 PSD 文档。");
        const layer = requireSingleSelection("停用资源");
        const resourceId = manifest.resourceRegistry.layerBindings[layer.id];
        if (!resourceId) throw new Error("选中图层尚未绑定资源。");
        const result = await execute("retire-resource", { resourceId });
        await inspectSelectedResource();
        return result.value;
      }));
      element("check-image-names").addEventListener("click", () => run("图片命名检查", async () => {
        const result = await checkImageNames(false);
        return { status: result.status, issues: result.issues };
      }));
      function resourceKindSummary(bundle) {
        const sprites = bundle.resources.filter((resource) => resource.kind === "sprite").length;
        const textures = bundle.resources.filter((resource) => resource.kind === "texture").length;
        return "".concat(sprites, " 个 Sprite、").concat(textures, " 个 Texture");
      }
      async function preflightCurrentDocument() {
        const prepared = await prepareCurrentDocumentForExport();
        const contentCheck = currentUiResFolder ? await verifyBundle(prepared.bundle, { uiResFolder: currentUiResFolder }) : null;
        const diagnostics = combineDiagnostics(
          prepared.preparationDiagnostics,
          prepared.bundle.diagnostics
        );
        const result = {
          issues: [],
          diagnostics,
          reconciliation: prepared.reconciliation,
          outputPath: currentUiResFolder && currentUiResFolder.nativePath || "",
          resources: prepared.bundle.resources.map((resource) => resource.fileName)
        };
        element("export-summary").textContent = "预检通过；".concat(resourceKindSummary(prepared.bundle), "，").concat(diagnostics.length, " 条非阻断诊断。") + (contentCheck ? "已核对图片内容，".concat(contentCheck.reusedResourceCount, " 个公共资源可复用。") : "选择输出目录后可检查同名公共资源。");
        return result;
      }
      element("preflight").addEventListener("click", () => run("导出预检", preflightCurrentDocument, { reportPreflight: true }));
      element("recheck-preflight").addEventListener("click", () => run("导出预检", preflightCurrentDocument, { reportPreflight: true }));
      element("export-bundle").addEventListener("click", () => run("导出 JSON 与图片", async () => {
        preflightContext = { documentKey: documentKey(), manifest: null, snapshot: null };
        const uiResFolder = requireUiResFolder();
        const prepared = await prepareCurrentDocumentForExport();
        const persisted = await persistManifest(prepared.manifest);
        const result = await writeBundle(prepared.bundle, { uiResFolder });
        element("export-summary").textContent = "已导出 ".concat(resourceKindSummary(prepared.bundle), "，复用 ").concat(result.reusedResourceCount || 0, " 个相同公共资源；").concat(result.json);
        return __spreadProps(__spreadValues({}, result), {
          diagnostics: combineDiagnostics(
            prepared.preparationDiagnostics,
            prepared.bundle.diagnostics
          ),
          reconciliation: prepared.reconciliation,
          sidecarPath: persisted.writeResult.sidecarPath
        });
      }, { reportPreflight: true }));
      var selectionRefreshTimer = null;
      var selectionRefreshRunning = false;
      var selectionRefreshQueued = false;
      async function refreshAfterSelectionChange() {
        if (operationRunning) {
          scheduleSelectionRefresh();
          return;
        }
        if (selectionRefreshRunning) {
          selectionRefreshQueued = true;
          return;
        }
        selectionRefreshRunning = true;
        try {
          do {
            selectionRefreshQueued = false;
            refreshContext();
            await refreshAuthoringState({ reuseDocument: true });
          } while (selectionRefreshQueued);
        } finally {
          selectionRefreshRunning = false;
        }
      }
      function scheduleSelectionRefresh() {
        selectionRefreshQueued = true;
        if (selectionRefreshTimer != null) clearTimeout(selectionRefreshTimer);
        selectionRefreshTimer = setTimeout(() => {
          selectionRefreshTimer = null;
          refreshAfterSelectionChange().catch((error) => {
            console.error("自动刷新 PSD2UI 图层状态失败，可使用“刷新当前状态”重试。", error);
          });
        }, 100);
      }
      async function enableSelectionRefresh() {
        await addSelectionChangeListener(scheduleSelectionRefresh);
      }
      function bootstrap() {
        resetImageDefaults();
        resetTextDefaults();
        setSemantic("image", false);
        setAdvancedResourceVisible(false);
        setStatusExpanded(false);
        PanelShell.activatePanel("prepare");
        refreshContext();
        refreshUiResFolder().catch((error) => {
          renderUiResFolder(null, "已保存的输出目录授权失效：".concat(formatError(error)));
        });
        refreshAuthoringState().catch((error) => console.error("首次读取 PSD2UI 配置状态失败。", error));
        enableSelectionRefresh().catch((error) => {
          console.error("PSD2UI 无法监听 Photoshop 图层选择变化，将保留人工刷新入口。", error);
        });
        writeStatus(
          "按「准备 PSD → 配置组件 → 检查导出」完成交付。首次保存组件也会自动初始化。",
          "从准备 PSD 开始"
        );
      }
      installDeveloperAutomation();
      bootstrap();
    }
  });

  // Plus-ins/PSD2UI-CEP/src/entry.js
  var require_entry = __commonJS({
    "Plus-ins/PSD2UI-CEP/src/entry.js"() {
      require_polyfills();
      var photoshop = require_photoshop();
      var { startCommandServer } = require_commandServer();
      var { startNotifications } = require_notifications();
      async function start() {
        require_uiShell();
        const summary = document.getElementById("status-summary");
        if (summary) summary.textContent = "正在连接 Photoshop…";
        globalThis.__PSD2UI_HOST_PROGRESS__ = (count) => {
          if (summary) summary.textContent = "正在读取 PSD，已读取 ".concat(count, " 个图层…");
        };
        await new Promise((resolve) => setTimeout(resolve, 100));
        await photoshop.initialize();
        delete globalThis.__PSD2UI_HOST_PROGRESS__;
        globalThis.__PSD2UI_REFRESH_HOST__ = () => photoshop.refresh();
        require_app();
        const commandServer = await startCommandServer({
          automation: globalThis.__PSD2UI_DEV__,
          isUncertain: () => require_hostRpc().isUncertain(),
          beforeInvoke: () => photoshop.refresh(),
          run: (label, action) => globalThis.__PSD2UI_RUN__(label, action),
          status: () => ({ photoshopVersion: photoshop.app.version || "", documentCount: photoshop.app.documents.length })
        });
        const notifications = await startNotifications({
          bridge: window.__adobe_cep__,
          photoshop,
          document,
          window,
          isBusy: () => Boolean(globalThis.__PSD2UI_BUSY__ && globalThis.__PSD2UI_BUSY__()),
          isUncertain: () => require_hostRpc().isUncertain()
        });
        window.addEventListener("beforeunload", () => {
          notifications.close();
          commandServer.close();
        });
      }
      start().catch((error) => {
        console.error(error);
        const target = document.getElementById("status");
        if (target) target.value = "PSD2UI 启动失败：".concat(error.message || error);
        const summary = document.getElementById("status-summary");
        if (summary) summary.textContent = "插件启动失败，请查看详情";
      });
    }
  });
  require_entry();
})();
