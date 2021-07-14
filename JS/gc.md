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

一个垃圾回收器通常都会实现的基本功能， 也叫做Mark-Sweep-Compact：(除去V8，其他也是这么做的，例如golang)
* 识别活/死的对象
* 回收/重用死对象占用的内存
* 压缩/碎片，整理内存（可选）

这些任务可以顺序执行，也可以额交错执行。一种直接的方法是暂停 Javascript的执行，对全堆进行处理（这种停止javascript执行的操作称之为`全停顿（stop-the-world）`）。如果对整个堆都进行这些任务，那可能需要很久 200ms? 或者更多。这可能会导致主线程出现卡顿和延迟问题，让我们一起看下 V8 是如何做优化的。

![过程](https://raw.githubusercontent.com/csywweb/blog/master/img/gc-main-thread.png)
### 世代假说

世代假说（generational hypothesis），也称为弱分代假说（weak generational hypothesis）。这个假说表明，大多数新生的对象在分配之后就会死亡（“用后即焚”），而老的对象通常倾向于永生。换句话说，从 GC 的角度来看，大多数对象都已分配，然后几乎立即变得无法访问。这不仅适用于 V8 或 JavaScript，也适用于大多数动态语言。

所以 V8 把垃圾回收分为了新生代和老生代，分别做了不同的处理。
新生代包括了 NEW_SPACE, 老生代包括了 OLD_SPACE、CODE_SPACE、OLD_LO_SPACE、OLCODE_LO_SPACE 

//原谅我蹩脚的翻译
NEW_SPACE又被分为了两部分，‘nursery（幼儿生）’ and ‘intermediate（小学生）’ 。
对象第一次被分配到 nursery （大对象会被分配到 newLargeSpace），如果他们在下一次 GC 中幸存下来。会继续留在年轻代中，被认为是 intermediate, 如果在下下次他们又活下来了。就会被移动到老生代中去。
对于LargeObject会做不一样的处理，第一次会在NEW_LO_SPACE 中存活，两次GC后他还在，就移动到 OLD_LO_SPACE 中去。

![](https://raw.githubusercontent.com/csywweb/blog/0740b2e8cff5bb4211158110db36a1fd57541b95/img/generation.svg)

分代堆利用了对象生命周期进行 压缩/移动。这似乎造成了一种感觉：“在GC时复制对象开销很大"。但是根据分代假设，只有很小一部分在垃圾回收中幸存下来。我们只需要付出幸存对象数量成正比的成本，不是分配数量。
### 垃圾回收器

V8 中有两个垃圾回收器。Marjor GC(Mark-Compact) 主要负责全堆的回收。Minor GC(Scavenger) 负责新生代的回收。

### Scavenger
新生代的垃圾回收方法为 **Scavenger**，幸存的对象总是被移动到一个新的页面。V8采用了一种以空间换时间的垃圾回收算法。基本思路就是将内存分成两半，任一时刻只有一半（semispace）被使用，在清扫期间，这个最初为空的区域称为“To-Space”。我们从中复制的区域称为“From-Space”。在最坏的情况下，每个对象都可以幸存下来，我们需要复制每个对象。

当程序需要创建新对象，而 New Space 的空间不够用时，Scavenge 就会启动，找到所有存活（可达）的对象移动到一个连续的内存块上去（TO_SPACE）。然后我们在两个空间上进行切换，即TO-SPACE 变成了 FROM-SPACE, FORM-SPACE 变成了 TO-SPACE。
还有一种情况是会在从 FORM-SPACE 到 TO-SPACE之前会判断TO-SPACE 的大小是否超过了25%，超过就直接晋升到老生代。这么做的原因是如果占比过大，GC完成之后，新分配的对象可能塞不进 FROM-SPACE。
当然了，对象晋升到OLD_SPACE时会判断OLD_SPACE的空间是否够用，如果够用才会晋升。
一但GC完成，新分配的对象就会发生在 From-Space 中的下一个空闲地址。

![](https://raw.githubusercontent.com/csywweb/blog/551fa72f556e92d70fea020f579d6d4108ab578f/img/from-to.svg)

那么在第二次 GC 中，之前已经存活的对象会被移动到 OLD_SPACE。
清理的最后一步是更新引用已移动的原始对象的指针。每个复制的对象都会留下一个转发地址，用于更新原始指针以指向新位置。

![](https://raw.githubusercontent.com/csywweb/blog/31af8bf228f459ac6cf49a591b1f1076cb4ad86c/img/from-to.svg)

在 Scavenger 的过程中，主要做了三件事
* 标记
* 移动
* 指针更新

新生代 Scavenger 的持续时间取决于新生代中的对象大小。当大多数对象不可达时，Scavenger 会很快（<1毫秒）。虽然 Scavenger 是 stop-the-world ，然而并不会影响很多性能。但是，如果大多数对象在 Scavenger 后存活下来，则 Scavenger 持续的时间会变得更长。

基于以上这点，V8 针对 Scavenger 做了一些优化。可以点击[这里（并行Scavenger）](https://v8.dev/blog/orinoco-parallel-scavenger)查看。

### 老生代 Mark-Sweep-Compact

#### Marking 标记

垃圾回收第一个重要部分是找到哪些对象可以被回收。GC 通过`可达性`来表示对象是否要被回收。这意味着当前运行时可达的对象需要保留。不可达的对象需要被回收。

Marking 是找到可达对象的过程。GC 从一组已知的对象指针开始，称为根集(root)。这包括执行堆栈和全局对象。然后它跟随每个指向 JavaScript 对象的指针，并将该对象标记为可达。GC 跟踪该对象中的每个指针，并递归地继续此过程，直到找到并标记运行时中可到达的每个对象。在标记结束时，应用程序无法访问堆中未被标记的对象，并且可以安全的回收。

##### 标记的过程

我们可以将标记视为图遍历。堆上的对象是图的节点。从一个对象到另一个对象的指针是图的边。给定图中的一个节点，我们可以使用对象的[隐藏类](https://v8.dev/blog/fast-properties)找到该节点的所有出边。