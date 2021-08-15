# 事件流

分为DOM 0 级事件，DOM 2级事件，DOM 3级事件。

DOM 0级事件，onclick, 写在html上或者dom.onclick。

DOM 2级事件，addEventListener. 第三个参数 true 是否在捕获阶段触发，第三个参数也可以是一个对象。

DOM 3级事件， 自定义事件。createEvent();

事件触发流程，先捕获，后冒泡。 从document开始，从document结束。

currentTarget 和 Target的区别：事件委托时，currentTarget时委托的target。target是当前点击的目标。

为啥 onclick 比 addEventListener 先触发？
还不清楚这个