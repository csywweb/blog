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

V8的堆最大的大小为：
```
size_t Heap::MaxReserved() {
  const size_t kMaxNewLargeObjectSpaceSize = max_semi_space_size_;
  return static_cast<size_t>(2 * max_semi_space_size_ +
                             kMaxNewLargeObjectSpaceSize +
                             max_old_generation_size());
}
```
大小为 NEW_SPACE+NEW_LO_SPACE+OLD_SPACE,在64位系统是1464MB， 32位系统是732MB
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
对于LargeObject会做不一样的处理，GC后他还在，就移动到 OLD_LO_SPACE 中去。

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

基于以上这点，V8 针对 Scavenger 做了一些优化。

V8 使用并行Scavenger在新生代 GC 期间跨辅助线程分配工作。每个线程都会接收一些指针，它会紧随其后，急切地将任何活动对象疏散到 To-Space 中。当试图疏散一个对象时，Scavenger任务必须通过原子读/写/比较和交换操作进行同步；另一个Scavenger任务可能通过不同的路径找到了相同的对象，并尝试移动它。无论哪个助手成功移动了对象，然后返回并更新指针。它留下一个转发指针，以便到达该对象的其他工作人员可以在找到其他指针时更新其他指针。对于幸存对象的快速无同步分配，清理任务使用线程本地分配缓冲区。

![](https://v8.dev/_img/trash-talk/08.svg)

可以点击[这里（并行Scavenger）](https://v8.dev/blog/orinoco-parallel-scavenger)查看更多。

### 老生代 Mark-Sweep-Compact

#### Marking 标记

垃圾回收第一个重要部分是找到哪些对象可以被回收。GC 通过`可达性`来表示对象是否要被回收。这意味着当前运行时可达的对象需要保留。不可达的对象需要被回收。

Marking 是找到可达对象的过程。GC 从一组已知的对象指针开始，称为根集(root)。这包括执行堆栈和全局对象。然后它跟随每个指向 JavaScript 对象的指针，并将该对象标记为可达。GC 跟踪该对象中的每个指针，并递归地继续此过程，直到找到并标记运行时中可到达的每个对象。在标记结束时，应用程序无法访问堆中未被标记的对象，并且可以安全的回收。

##### 标记的过程

我们可以将标记视为图遍历。堆上的对象是图的节点。从一个对象到另一个对象的指针是图的边。给定图中的一个节点，我们可以使用对象的[隐藏类](https://v8.dev/blog/fast-properties)找到该节点的所有出边。

![](https://raw.githubusercontent.com/csywweb/blog/master/img/object.svg)

**标记的位置**
V8 为每一个内存页维护了一个 marking bitmap，页内的每一个可用于分配的字在其中都有一个对应的 bit，对象们对应 2 个 bit，于是这个标记最多能有 4 种类型。

V8 使用每个对象两个标记位和一个标记工作列表(marking-worklist)来实现标记。两个标记位编码三种颜色：白色 (00)、灰色 (10) 和黑色 (11)。
* 最初所有对象都是白色的，这意味着收集器还没有发现它们。当
* 收集器发现白色对象并将其push到标记工作列表(marking-worklist)时，它会变成灰色。
* 当收集器从marking-worklist中pop出灰色对象并访问其所引用，灰色对象将变为黑色，并且把它的引用标记为灰色，push 进 marking-worklist。

这种方案称为三色标记。如此循环往复，直到栈上的所有对象都 pop 掉了为止。当不再有灰色对象时，标记结束。所有剩余的白色对象都无法访问，可以安全回收。

> 上面这一段是我在其他博客里看到的，但是在源码里，有四个标志，最后一个kImpossibleBitPattern是干嘛的，我也不太清楚
``` C++
const char* Marking::kWhiteBitPattern = "00";
const char* Marking::kBlackBitPattern = "11";
const char* Marking::kGreyBitPattern = "10";
const char* Marking::kImpossibleBitPattern = "01";
```

标记从根开始
![](https://v8.dev/_img/concurrent-marking/01.svg)
收集器通过处理指针将灰色对象变成黑色
![](https://v8.dev/_img/concurrent-marking/02.svg)
标记完成后的最终状态
![](https://v8.js.cn/_img/concurrent-marking/03.svg)

需要注意的是，上述标记法仅适用于在标记进行中应用程序暂停的情况。如果我们允许应用程序在标记过程中运行，那么应用程序可能改变图并且最终欺骗收集器释放活动对象。

##### 增量标记

对一个比较大的堆执行标记过程可能需要几百毫秒才能完成。
![](https://v8.js.cn/_img/concurrent-marking/04.svg)

这样长时间的停顿可能会使应用程序无响应，并导致用户体验不佳。在 2011 年，V8 从 stop-the-world 标记切换到增量标记。在增量标记期间，垃圾收集器将标记工作分解为更小的块，并且允许应用程序在块之间运行：

![](https://v8.js.cn/_img/concurrent-marking/05.svg)

垃圾收集器选择在每个块中执行多少增量标记来匹配应用程序的分配速率。一般情况下，这极大地提高了应用程序的响应速度。对内存压力较大的堆，收集器仍然可能出现长时间的暂停来维持分配。

关于增量标记产生的代价请戳[这里](https://v8.js.cn/blog/concurrent-marking/)

为了改善应用程序的吞吐量和暂停时间。V8提出了两种优化方法：并行标记和并发标记:

**并行标记**发生在主线程和工作线程上。应用程序在整个并行标记阶段暂停。它是 stop-the-world 标记的多线程版本。

![](https://v8.js.cn/_img/concurrent-marking/06.svg)

**并发标记**主要发生在工作线程上。当并发标记正在进行时，应用程序可以继续运行：
![](https://v8.js.cn/_img/concurrent-marking/07.svg)

##### 并行标记

在并行标记的时候，我们可以假定应用都不会同时运行。这大大的简化了实现，因为我们可以假定对象图是静态的，而且不会改变。为了并行标记对象图，我们需要让垃圾收集数据结构是线程安全的，而且寻找一个可以在线程间运行的高效共享标记的方法。下面的示意图展示了并行标记包含的数据结构。箭头代表数据流的方向。简单来说，示意图省略了堆碎片处理所需的数据结构。

![](https://v8.js.cn/_img/concurrent-marking/08.svg)

##### 标记工作列表和工作窃取

标记工作列表（marking-worklist）的实现对并行标记的性能至关重要，而且它通过在其他线程没有工作可做的情况下，有多少工作可以分配给他们，来平衡快速线程本地的性能。

要权衡的两个极端的情况是
* 使用完全并发数据结构，达成最佳共享即所有对象都可以隐式共享
* 使用完全本地线程（thread-local）数据结构，没有对象可以共享，优化线程本地吞吐量。

下图展示了 V8 是如何通过使用一个基于本地线程插入和删除的段的标记工作列表来平衡这些需求的。一旦一个段满了，它会被发布到一个可以用来窃取的共享全局池。使用这种方法，V8 允许标记线程在不用任何同步的情况下尽可能长的执行本地操作，而且还处理了当单个线程达成了一个新的对象子图，而另一个线程在完全耗尽了本地段时饥饿的情况。

![](https://v8.js.cn/_img/concurrent-marking/09.svg)

##### 并发标记

当 worker thread 正在访问堆上的对象同事，并发标记云溪 JS 在主线程上运行。这为潜在的竞态数据打开大门。举个例子：当工作者线程正在读取字段时，JavaScript 可能正在写入对象字段。竞态数据会混淆垃圾回收器释放活动对象或者将原始值和指针混合在一起。

主线程的每个改变对象图的操作将会是竞态数据的潜在来源。由于 V8 是具有多种对象布局优化功能的高性能引擎，潜在竞态数据来源相当多。以下是 high-level 列表：

* 对象分配
* 写对象
* 对象布局变化
* 快照反序列化
* 功能去优化（deopt）实现
* 新生代垃圾回收期间的疏散
* 代码修补

在以上这些操作上，主线程需要与工作线程同步。同步代价和复杂度视操作而定。大部分操作允许轻量级的同步和原子操作之间的访问，但是少部分操作需独占访问对象。

##### 一起使用

我们将并发标记整合到现有的增量标记基础设施中。主线程通过扫描 root 并填充标记工作表来启动标记。之后，它会在工作线程中发布并发标记任务。工作线程通过合作排除标记工作表来帮助主线程加快标记进度。偶尔主线程通过处理 bailout worklist 和标记工作表来参与标记。标记工作表变空之后，主线程完成垃圾收集。在最终确定期，主线程重新扫描 root，可能会发现更多的白色对象。这些对象在工作线程的帮助下被并行标记。

![](https://v8.js.cn/_img/concurrent-marking/11.svg)

#### Sweeping 清理

**Sweeping**阶段就是将非活动对象占用的内存空间添加到一个叫空闲列表（free-list）的数据结构中。一旦标记完成，垃圾回收器会找到不可访问对象的内存空间，并将内存空间添加到相应的空闲列表中。空闲列表中的内存块由大小来区分，为什么这样做呢？为了方便以后需要分配内存，就可以快速的找到大小合适的内存空间并分配给新的对象。

```
 Page 1              FreeList                        Page 1
+----------+        +--------------+		+------------+
|marked: * |---\    |    Size 1    |	--------|marked: s   |   s:s=survived
+----------+    \   | +----------+ |   /	+------------+
|marked:   |     ---|>|__________| |  /	       -|marked: s   |
+----------+        | |__________|<|--        /	+------------+
|marked: * |--\     | |__________| |         /	|            |
+----------+   \    |    Size 2    |        /	+------------+
|marked:   |    \   | +----------+ |       /	|            |
+----------+     ---|>|__________|<|-------	+------------+
|marked:   |        | |__________| |		|            |
+----------+        | |__________| |            +------------+
                    +--------------+

```
在 sweeping 方面，V8 引入了 lazy sweeping，当我们已经标记完哪些对象的内存可以被回收之后，并没有必要马上回收完这些内存，然后再开始运行。我们可以先恢复程序的运行，再一点点对各页的空间做 sweeping。当然，只有当所有页的内存都被回收完之后，我们才能重新开始 marking。

另外，由于这些死亡对象占据的空间不会在被运行中的程序使用，V8 还引入了 concurrent sweeping，让其他线程同时来做 sweeping，而不用担心和执行程序的主线程冲突，这样在 sweeping 的时候，就不需要暂停程序的执行了。

同样地，因为 sweeping 作用的对象们已经确定而且不会被主线程访问，可以比较容易地并行化，V8 引入了 parallel sweeping，让多个 sweeping 线程同时工作，提升 sweeping 的吞吐量，缩短整个 GC 的周期。



####  整理 Compaction
主垃圾回收器会通过一种叫做碎片启发式（fragmentation heuristic）的算法来整理内存页)，你可以将整理阶段理解为老式 PC 上的磁盘整理。那么碎片启发式算法是怎么做的呢？我们将活动对象复制到当前没有被整理的其他内存页中（即被添加到Freelist的内存页）；通过这种做法，我们就可以利用内存中高度小而分散的内存空间。

垃圾回收器复制活动对象到当前没有被整理的其他内存页中有一个潜在的缺点，我们要分配内存空间给很多常驻内存（ long-living）的对象时，复制这些对象会带来很高的成本。这就是为什么我们只选择整理内存中高度分散的内存页，并且对其他内存页(LO_SPACE)我们只进行清除而不是也同样复制活动对象的原因。

#### 空闲 GC

JavaScript 是无法去直接访问垃圾回收器的，这些都是在V8的实现中已经定义好的。但是 V8 确实提供了一种机制让Embedders（嵌入V8的环境）去触发垃圾回收，即便 JavaScript 本身不能直接去触发垃圾回收。垃圾回收器会发布一些 “空闲时任务（Idle Tasks）”，虽然这些任务都是可选的，但最终这些任务会被触发。像 Chrome 这些嵌入了 V8 的环境会有一些空闲时间的概念。比如：在 Chrome 中，以每秒60帧的速度去执行一些动画，浏览器大约有16.6毫秒的时间去渲染动画的每一帧，如果动画提前完成，那么 Chrome 在下一帧之前的空闲时间去触发垃圾回收器发布的空闲时任务。

![](https://v8.js.cn/_img/trash-talk/10.svg)

[V8对标记清理的更多优化](https://v8.dev/blog/orinoco)
#### 老生代回收时机

老生代的 GC 什么时候开始呢？

> 这一块可能不是那么的准确，从源码中得出的结论，受限于我的C++水平，请大家辩证的去看

在堆中创建对象的时候，会调用`StartIncrementalMarkingIfAllocationLimitIsReached`这个方法来开始。

代码在 paged-spaces.cc 和 larged-spaces.cc。创建对象的代码在 heap.h
```c++
V8_WARN_UNUSED_RESULT inline AllocationResult AllocateRaw (
       int size_in_bytes, AllocationType allocation, 
      AllocationOrigin origin = AllocationOrigin:: kRuntime , 
      AllocationAlignment alignment = kWordAligned );
```
找了一圈，在堆中创建一个内存块的代码在 paged-spaces.cc 和 larged-spaces.cc（CODE_LO_SPACE,NEW_LO_SPACE,OLD_LO_SPACE 都会调用larged-spaces.cc的AllocateRaw，正常对象都会调用 paged-spaces.cc 中的cc的AllocateRaw）。

以下是 `paged-spaces.cc`中的代码。

```
AllocationResult PagedSpace::AllocateRawSlow(int size_in_bytes,
                                             AllocationAlignment alignment,
                                             AllocationOrigin origin) {
  if (!is_compaction_space()) {
    
    heap()->StartIncrementalMarkingIfAllocationLimitIsReached(
        heap()->GCFlagsForIncrementalMarking(),
        kGCCallbackScheduleIdleGarbageCollection);
  }
```

`StartIncrementalMarkingIfAllocationLimitIsReached` 方法如果当前没有开始标记，才会开始任务，如果当前已经开始了任务，则什么都不做。如果没开始，这个方法会调用`IncrementalMarkingLimitReached`,来判断当前内存状态，根据堆空间返回`kHardLimit`、`kNoLimit`、`kSoftLimit`、`kFallbackForEmbedderLimit`来执行对应的任务策略。具体代码在`heap.cc`。
```c++
// - kNoLimit means that either incremental marking is disabled or it is too
// early to start incremental marking.
// - kSoftLimit means that incremental marking should be started soon.
// - kHardLimit means that incremental marking should be started immediately.
// - kFallbackForEmbedderLimit means that incremental marking should be
// started as soon as the embedder does not allocate with high throughput
// anymore.
Heap::IncrementalMarkingLimit Heap::IncrementalMarkingLimitReached() {
```

第二点，V8在创建对内存的时候，会设置一个 Observer：`StressMarkingObserver`，Observer里也有`StartIncrementalMarkingIfAllocationLimitIsReached`的调用。在初始化堆内存的时候，会给老生代生成这个observer，但是具体怎么用，我还没看明白。0.0

## 小结

V8的垃圾回收经过了满场的发展。总结一下整体思路就是先分代，新生代空间换时间，并且添加了并行Scavenger。老生添加并行、并发和增量垃圾回收技术经过了很多年的努力，并且也已经取得了一些成效。将大量的移动对象的任务转移到后台进行，大大减少了主线程暂停的时间，改善了页面卡顿，让动画，滚动和用户交互更加流畅。

当然了 V8 引擎还在做更多。目前正在改善 Blink 中的垃圾回收器(Oilpan)和V8垃圾回收器（Orinoco）的协作，准备将一些新技术从 V8 的垃圾回收移植到 Oilpan 上。可以看[这里了解更多](https://v8.dev/blog/high-performance-cpp-gc)。

大部分 JavaScript 开发人员并不需要考虑垃圾回收，但是了解一些垃圾回收的内部原理，可以帮助你了解内存的使用情况，以及采取合适的编范式。比如：从 V8 堆内存的分代结构和垃圾回收器的角度来看，创建生命周期较短的对象的成本是非常低的，但是对于生命周期较长的对象来说成本是比较高的。

本文没有提及`引用计数`，是因为 V8 从最开始就没有用过引用计数。

## 后记

学习垃圾回收的整个过程，可以说是痛并快乐着。官方的blog比较分散，资料中关于内存分配、堆栈操作，看的是一脸懵。对C++语言的不熟悉，更是难上加难，对于计算机基础知识还是有所欠缺。这篇文章有一些不足的地方，也欢迎大家指正。学无止境，任重而道远

## 相关引用

> [https://v8.dev/blog/trash-talk](https://v8.dev/blog/trash-talk)
  [https://v8.dev/blog/orinoco-parallel-scavenger](https://v8.dev/blog/orinoco-parallel-scavenger)
  [https://github.com/danbev/learning-v8/blob/master/notes/heap.md#heap](https://github.com/danbev/learning-v8/blob/master/notes/heap.md#heap)
  [https://developer.aliyun.com/article/592878](https://developer.aliyun.com/article/592878)
  [https://v8.dev/blog/free-garbage-collection](https://v8.dev/blog/free-garbage-collection)
  [https://v8.js.cn/blog/jank-busters/](https://v8.js.cn/blog/jank-busters/)
  [https://v8.dev/blog/concurrent-marking](https://v8.dev/blog/concurrent-marking)