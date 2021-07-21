const assert = require('assert');

// 实现一个loadsh get
// __get(obj, 'a[3].b', null)

const get = (data, path, defaultVaule = void 0) => {
    const paths = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let result = data;
    for (_path of paths) {
        result = Object(result)[_path];
        if (result == null) {
            return defaultVaule
        }
    }

    return result;
}

//try
(function(get){
    const obj = {
        a: [1,2, {c:2}],
        b: 3,
    }
    assert.strictEqual(get(obj, 'a[2].c', '没有值'), 2)
    assert.strictEqual(get(obj, 'a[1].c', '没有值'), '没有值')
    assert.strictEqual(get(obj, 'a[1]', '没有值'), 2)
    assert.strictEqual(get(obj, 'b', '没有值'), 3)
    assert.strictEqual(get(obj, 'c', '没有值'), '没有值')
})(get)

// curry
// 原来函数的参数长度 fn.length
// 没错返回新的函数
// 每次函数执行的时候，收集参数
// 终止条件：收集参数个数 (arg.length === fn.length) 执行原函数
const curry = (fn) => (
    temp = (...args) => {
        args.length === fn.length ? fn(...args) : (...args2) => temp(...args2, ...args);
    }
)

// curry2 不定参数
const curry2 = (fn) => (
    temp = (...args) => {
        args.length === 0 ? fn(...args) : (...args2) => temp(...args2, ...args);
    }
)

(function(curry, curry2){
    function add(a,b,c) {
        return a+b+c;
    }
    const newAdd = curry(add);

    function multipleAdd(...args) {
        return args.reduce((total, current) => {
            return total + current;
        }, 0)
    }
    const newMultipleAdd = curry2(multipleAdd);
    assert.strictEqual(newAdd(1)(2,3), 6)
    assert.strictEqual(newAdd(1)(2)(3), 6)
    assert.strictEqual(newMultipleAdd(1)(2)(3)(), 6)
})(curry, curry2);

// async await
const sleep = (str) => new Promise(r =>  setTimeout(() => r(str), 1000))
// generate
function *test() {
    console.log("in");
    const rest1 = yield sleep('first');
    console.log("first:", rest1);
    const rest2 = yield sleep("second");
    console.log("second:", rest2);
    return 'success';
}

const gen = test();
console.log(gen);
const r = gen.next('123123');
console.log(1, r)
const s = gen.next('22222');
console.log(2, s)
const t = gen.next('3333');
console.log(3, t);

function asyncStepGenerate(gen, resolve, reject, _next, _throw, key, arg) {
    let value;
    try {
        const result = gen[key][arg];
        value = result.value;
    } catch (error) {
        reject(error);
        return;
    }

    // 边界
    if (result.done) {
        resolve(value)
    } else {
        Promise.resolve(value).then(_next, _throw)
    }
}

function fakeAsync(fn) {
    return function() {
        const self = this;
        const args = arguments;
        return new Promise((reslove, reject)=> {
            const gen = fn.apply(self, args);

            function _next(value) {
                asyncStepGenerate(gen, reslove, reject, _next, _throw, 'next', value);
            }

            function _throw(error) {
                asyncStepGenerate(gen, reslove, reject, _next, _throw, 'error', error);
            }

            _next(void 0)
        })
    }
}