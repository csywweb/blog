// scheduler 
/**
 * 保证同时运行任务最多有两个
 * class Scheduler {
 *    add(promiseCreator) {...}
 * }
 * 
 * const timeout = (time) => new Promise(r => setTimeout(r, t));
 * const scheduler = new Scheduler();
 * const addtasks = (time, order) => {
 *  scheduler.add(() => timeout(time)).then(() => console.log(order))
 * }
 * 
 * addtasks(1000, '1')
 * addtasks(500, '2')
 * addtasks(300, '3')
 * addtasks(400, '4')
 * 
 * output: 2,3,1,4
 */

// class Scheduler {
//     constructor(max = 2) {
//         this.MAX_LENGTH = 2;
//         this.tasks = [];
//         this.pool = [];
//     }
//     add(promiseCreator) {
//         this.tasks.push(promiseCreator);
//         return this.run();

//     }
//     run() {
//         console.log('---')
//         // 有任务 池子也够用
//         if(this.pool.length < this.MAX_LENGTH && this.tasks.length > 0 ) {
//             const task = this.tasks.shift();
//             const p = task().then(() => {
//                 // 执行完从pool里删了
//                 this.pool.splice(this.pool.indexOf(p), 1);
//                 console.timeLog('start');
//             })
//             this.pool.push(p);
//             return p;
//         } else {
//             console.log("===")
//             return Promise.race(this.pool).then(() =>this.run());
//         }
//     }
// }

// const scheduler = new Scheduler();
// const timeout = (t) => new Promise(r => setTimeout(r, t));
// const addtasks = (time, order) => {
//   scheduler.add(() => timeout(time)).then(() => console.log("order:", order))
// }

// console.time('start');
// addtasks(1000, '1')
// addtasks(500, '2')
// addtasks(300, '3')
// addtasks(400, '4')


class Scheduler {
    constructor(max = 1) {
        this.MAX_LENGTH = 1;
        this.count = 0;
        this.waitList = [];
    }

    async add(promiseCreator) {
        if (this.count >= this.MAX_LENGTH) {
            await new Promise(r => this.waitList.push(r));
        }

        console.log(213);
        this.count++;
        const result = await promiseCreator();
        this.count--;

        //释放等待队列中的reslove
        if (this.waitList.length > 0) {
            this.waitList.shift()();
        }
        return result;
    }
}

const scheduler = new Scheduler();
const timeout = (t) => new Promise(r => setTimeout(r, t));
const addtasks = (t, order) => {
  scheduler.add(() => new Promise(r => {console.log(1);setTimeout(r, t)})).then(() => console.log("order:", order))
}
console.time();
addtasks(1000, '1')
addtasks(500, '2')
addtasks(300, '3')
addtasks(400, '4')
// (function main() {
//     var data = [{
//         id: 1,
//         parentId: null,
//         name: '南京分公司'
//     },
//     {
//         id: 2,
//         parentId: null,
//         name: '北京分公司'
//     },
//     {
//         id: 3,
//         parentId: 1,
//         name: '南京业务部'
//     },
//     {
//         id: 4,
//         parentId: 1,
//         name: '南京法务部'
//     },
//     {
//         id: 5,
//         parentId: 2,
//         name: '北京业务部'
//     },
//     {
//         id: 6,
//         parentId: 2,
//         name: '北京法务部'
//     }]
//     // 写一个函数，实现将data数据转为 ，[{id: xx, name: xx, children: [xxx]}]树形结构
//     function generateTree(arr) {

//         // 先把跟拿出来
//         let start = 0;
//         for (let i = 1; i < data.length; i++) {
//             if (!data[i].parentId) {
//                 let temp = data[i];
//                 data[i] = data[start];
//                 data[start] = temp;
//                 start++;
//             }
//         }
//         const tree = data.slice(0, start + 1);
//         const childs = data.slice(start + 1, data.length);

//         for (let j = 0; j < tree.length; j++) {
//             const child = getchild(tree[j].id);
//             tree[j].children = child;
//         }
//         function getchild(parentId) {
//             const result = [];
//             for (let k = 0; k < childs.length; k++) {
//                 const child = childs[k];
//                 if (child.parentId === parentId) {
//                     child.children = getchild(child.id);
//                     result.push(child);
//                 }
//             }
//             console.log("result:", result);
//             return result;
//         }
//         return tree;
//     }

//     console.dir(generateTree(data));
// }());