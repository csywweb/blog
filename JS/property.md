# 如何理解js中的原型链

每一个JavaScript 对象都有一个隐藏属性[[Prototype]]，这个属性可以是一个对象的引用，也可以是null（object.create(null)创建的没有原型）。一般情况下一个javascript 对象的 [[Prototype]] 的值是 Obecjt.Prototype。

编程中我们经常想扩展一些东西。例如对象b想重用对象a的方法。这个时候不需要重新实现一个新对象，而是可以去修改对象b的原型链，让其指向对象a。修改 Prototype 的方式常见的有 __proto__ , 这是[[Prototype]]的getter/setter。那么对象a,b就形成了一个链表，对象b通过[[Prototype]]连接了a。

当我们在一个对象上查找属性和方法的时候，会自下而上的去查找对象，最顶端会找到 Object.prototype,找不到则返回undefined。
