CommonJs AMD CMD ESM 的区别

commonJs 是 node端的规范。特点是

所有代码运行在模块作用域，不会污染全局作用域
模块是同步加载的，只有加载完成，才会执行后面的操作
模块首次加载会被缓存，
模块输出的是值的浅拷贝
AMD

require.js 适用于多端。
define 方法。(id, dependencies, factory)
dependencies 添加依赖变成 factory的参数
CMD

sea.js
和AMD的区别是依赖通常写在 factory的参数里，
factory的参数 require export module
CMD模块就近依赖，用到了才require。AMD先require
ESM

esm 输出的是值的引用。
esm 导入路径只能是字符串，commonjs可以是表达式
esm 中的this指向undefined，cjs指向当前对象
esm 中没有这些顶层变量，类似： module、export 、__dirname、__firename、require
