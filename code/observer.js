/**
 * //评测题目: 无
1、实现一段代码，通过传入对象和相关路径，能监听对象的值变化。
// ---------- 示例 ------------
var o = {
  a: 1,
  b: 2,
  c: {
    d: {
      e: 3,
      f: 4
    }
  }
}

observer(o, ['a', 'c.d.e'], (preValue, newValue) => {
  console.log(`observer: ${preValue} => ${newValue}`);
});


o.a = 5; // observer: 1 => 5
o.b = 6; // 不打印
o.c.d.e = 7; // observer: 3 => 7
o.c.d.f = 8; // 不打印

// --------- 实现 ----------
function observer(obj, pathArr, cb) {

}

 */
function observer(obj, pathArr, cb) {
    function loopObserver(obj, preKey = '') {
        for(key in obj) {
            const currentKey = preKey ? preKey + '.' + key : key;
            if (pathArr.includes(currentKey)) {
                const bindKey = currentKey.split('.').pop();
                const currentVal = obj[bindKey];
                Object.defineProperty(obj, bindKey, {
                    set(value) {
                       
                        cb(currentVal, value);
                        return value
                    }
                })
            }
    
            // 他还是对象，继续走
            if (Object.prototype.toString.call(obj[key]) == '[object Object]') {
                loopObserver(obj[key], preKey ? preKey + '.' + key : key);
            }
            // if (Object.prototype.toString.call(obj[key]) == '[object Array]') {
            //     // 监听数组
            //     const arrApi = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'];
            //     arrApi.forEach((key) => {
            //         Object.defineProperty(newProto, prop, {
            //             value: function (newVal) {
            //                 callback( newVal);
            //                 arrayProto[prop].apply(a_array, arguments);
            //             },
            //         });
            //     })
            // }
        }
    }
    loopObserver(obj);
}

var o = {
    a: 1,
    b: 2,
    c: {
      d: {
        e: 3,
        f: 4
      }
    }
  }

  observer(o, ['a', 'c.d.e'], (preValue, newValue) => {
    console.log(`observer: ${preValue} => ${newValue}`);
  });

  o.a = 10;
  o.c.d.e = 10
  o.b = 10;