# Set

Set可以理解为没有重复元素的集合，判断元素是否重复的方法叫做：‘Same-value-zero equality’, 近似于‘===’。区别在于 NaN 用 三等号是不相等的，但是Set认为他相同。

# WeakSet

和Set类似，成员不能重复，区别： wakeSet的成员只能是对象,wakeSet 不能遍历。

为啥不能遍历呢，因为wakeSet里都是弱引用，不会被垃圾回收标记到，在标记阶段，不会通过可达性来判断是否标记。

# Map

