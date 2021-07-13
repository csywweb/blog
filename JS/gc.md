# V8垃圾回收

## 前言

在学习 javascript 的过程中，开发这不需要去关注内存的分配/释放。这一切全归功于背后的 v8 引擎默默为我们做了这一切。本文将从v8的**内存管理**和**内存回收**的角度来阐述垃圾回收的整个过程。也有一些不是很清楚点，欢迎大家在评论区一起探讨

## v8 内存分配

我们都知道js在执行的时候，基本类型保存在栈（stack）里，引用类型保存在堆（heap）里。

### 栈内存

#### 为什么栈内存不需要进行垃圾回收

* 栈中的执行上下文会随着函数的调用而出栈被销毁。在js执行过程中，上下文中的变量和函数（以及函数内部的变量）都会保存在栈中，当函数执行完，也会随之出栈。栈中的内容也会被销毁。

* 栈的扩容很方便，只需要修改栈的长度。（但是有上限）

#### 栈的大小

可以使用
```
node --v8-options | grep -B0 -A1 stack_size
```
命令查看栈的大小

操作系统对每组线程的栈内存有一定的限制，为适应线程各种操作系统,栈的默认大小根据不同平台有不同的限制，
##### 在ARM和ARM64 平台上栈的默认大小为 **864**KB
* 在ARM平台上，由于 Arm架构的栈需要分配给[MacroAssembler](https://developer.arm.com/documentation/dui0489/c/directives-reference/assembly-control-directives/macro-and-mend?lang=en) **120**KB 
* ARM64架构上，启动一个单进程的android webview会初始化v8时已经有了一个大的栈，所以需要设置少一点

##### 在x86大小为**984**KB
* 略小于1MB，因为Windows的默认堆栈大小32位和64位的主执行线程都是1MB。(更具体的原因不清楚为什么时984kb)

**栈最小大小为 40kb**

### 堆内存

> 为什么不在栈中保存所有数据呢? 
因为栈的空间是连续的，所以他的空间注定是有限的。不方便储存大的数据，这个时候就需要堆来解决这个问题。

在 v8 中，大部分的对象都直接在堆上创建（虽然v8的编译优化会将一些完全本地的对象放在栈里**Escape Analysis**，以及Buffer是通过申请系统内存分配，此处不赘述）

v8将堆划分成来几个不同的Space(以下以9.x版本为主)
```c++
NewSpace* new_space_ = nullptr;
OldSpace* old_space_ = nullptr;
CodeSpace* code_space_ = nullptr;
MapSpace* map_space_ = nullptr;
OldLargeObjectSpace* lo_space_ = nullptr;
CodeLargeObjectSpace* code_lo_space_ = nullptr;
NewLargeObjectSpace* new_lo_space_ = nullptr;
ReadOnlySpace* read_only_space_ = nullptr;
```
```
+----------------------- -----------------------------------------------------------+
|   Young Generation                  Old Generation          Large Object space    |
|  +-------------+--------------+  +-----------+-------------+ +------------------+ |
|  |        NEW_SPACE           |  | MAP_SPACE | OLD_SPACE   | | OLD_LO_SPACE     | |
|  +-------------+--------------+  +-----------+-------------+ +------------------+ |
|  |  from_Space   | to_Space   |                                                   |
|  +-------------+--------------+                                                   |
|  +-------------+                 +-----------+               +------------------+ |
|  | NEW_LO_SPACE|                 | CODE_SPACE|               | CODE_LO_SPACE    | |
|  +-------------+                 +-----------+               +------------------+ |
|                                                                                   |
|   Read-only                                                                       |
|  +--------------+                                                                 |
|  | RO_SPACE     |                                                                 |
|  +--------------+                                                                 |
+-----------------------------------------------------------------------------------+
```
#### 堆构成
可以看到v8的堆内存由新生代和老生代以及大对象空间组成。
v8将堆内存划分为固定大小的块，叫做**Page**（页面），大小为256kb。新生代中两个semispaces中内存是连续的，老生代中 Page 是分散的，以链表的形式串联起来。一个 Page 由一个 page header和object area组成。
##### 新生代
新生代包括**New_Space**，**NEW_LO_SPACE**， **RO_SPACE**。

* 其中**New_Space**被分为两个大小一样的空间（**semispaces**），在32位系统下一个 semispaces 的大小为8M，64位系统下 semispaces 大小为 16M。两个 semispaces 我们称之为 From 空间和 To 空间，在下文垃圾回收部分会讲到，这里不做过多赘述。

* **NEW_LO_SPACE** 的大小等于一个 semispaces 的大小。保存的是新生代的大对象。在新生代执行 **Scavenge** 算法的时候，也会对 NEW_LO_SPACE 中的对象处理，移动到 OLD_LO_SPACE.
  ```c++
  void ScavengerCollector::HandleSurvivingNewLargeObjects() {
  for (SurvivingNewLargeObjectMapEntry update_info :
       surviving_new_large_objects_) {
        HeapObject object = update_info.first;
        Map map = update_info.second;
        // Order is important here. We have to re-install the map to have access
        // to meta-data like size during page promotion.
        object.set_map_word(MapWord::FromMap(map), kRelaxedStore);
        LargePage* page = LargePage::FromHeapObject(object);
        heap_->lo_space()->PromoteNewLargeObject(page);
    }
    surviving_new_large_objects_.clear();
    }
  ```
* **Read Only Space** 保存不可变对象和不可移动的对象。TODO 具体做什么的，很抱歉这部分我也没看懂。

##### 老生代
老生代分为 **Map Space**、**Old_Space**、**CODE_SPACE**。
* Map_Space 包含所有对象的map(对象的布局结构信息,这里和对象隐藏属性有关)。
* 其余非Large对象存储到 OLD_SPACE
* Code Space 保存V8编译出来的代码

##### Large Object Space
Large Object Space会单独分配一个大于 **kMaxRegularHeapObjectSize**（256kb） 的空间，以便于在垃圾回收期间不会移动。大对象空间中的 Page 通常大于 256kb。V8判断一个对象是否是 Large Object space通常是判断对象的大小是否大于 二分之一的 kMaxRegularHeapObjectSize。

### 堆内存管理

V8 将堆划分为空间，空间划分为页。这些内存页里的内存是怎么来的呢？V8 为此抽象出了 Memory Allocator，专门用于与操作系统交互，当空间需要新的页的时候，它从操作系统手上分配（使用mmap）内存再交给空间，而当有内存页不再使用的时侯，它从空间手上接过这些内存，还给操作系统（使用munmap）。因此堆上的内存都要经过 Memory Allocator 的手，在垃圾回收日志中也能看到它经手过的内存的使用情况。
### 堆外内存

除了堆上的内存以外，V8 还允许用户自行管理对象的内存，比如 Node.js 中的 Buffer 就是自己管理内存的。这些叫做外部内存（external memory），在垃圾回收的时候会被 V8 跳过，但是外部的代码可以通过向 V8 注册 GC 回调，跟随 JS 代码中暴露的引用的回收而自行回收内存，相关信息也会显示在垃圾回收日志中。外部内存也会影响 V8 的 GC，比如当外部内存占用过大时，V8 可能会选择 Full GC（包含老生代）而不是仅仅回收新生代，尝试触发用户的 GC 回调以空出更多的内存来使用。

由于外部代码需要将自己使用的内存通过 Isolate::AdjustAmountOfExternalAllocatedMemory 告知 V8 才能记录下来，假如外部代码没有做好上报，就可能出现进程 RSS（Resident Set Size，实际占用的内存大小）很高，但减去垃圾回收日志中 Memory Allocator 分配的堆内存和 V8 记录下的外部内存之后，有很大一部分“神秘消失”的现象，这个时候就可以定位到 C++ addon 或者是 Node.js 自己管理的内存里去排查问题了。

## 垃圾回收

讲完了内存分配，让我们来看看垃圾回收的整个过程。

一个垃圾回收器通常都会实现的基本功能：(除去V8，其他也是这么做的，例如golang)
* 识别活/死的对象
* 回收/重用死对象占用的内存
* 压缩/碎片，整理内存（可选）

这些任务可以顺序执行，也可以额交错执行。一种直接的方法是暂停 Javascript的执行，对全堆进行处理（这种停止javascript执行的操作称之为`全停顿（stop-the-world）`）。如果对整个堆都进行这些任务，那可能需要很久 200ms? 或者更多。这可能会导致主线程出现卡顿和延迟问题，让我们一起看下 V8 是如何做优化的。

### 世代假说


