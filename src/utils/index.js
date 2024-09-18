/* global window */

import ForeignSet from './set';

const
    isSimpleObject = (obj) => {
        let token;
        if (typeof obj === 'object') {
            if (obj === null) { return false; }
            token = Object.prototype.toString.call(obj);
            if (token === '[object Object]') {
                return (obj.constructor.toString().match(/^function (.*)\(\)/m) || [])[1] === 'Object';
            }
        }
        return false;
    },
    minMsThreshold = 16,
    /* istanbul ignore next */win = typeof window === 'undefined' ? (this || {}) : window,
    // eslint-disable-next-line require-jsdoc
    /* istanbul ignore next */ reqAnimFrame = (isPrintMode) => {
        if (isPrintMode) {
            return function (callback) {
                setTimeout(callback, minMsThreshold);
            };
        }
        return win.requestAnimationFrame ||
            win.webkitRequestAnimationFrame ||
            win.mozRequestAnimationFrame ||
            win.oRequestAnimationFrame ||
            win.msRequestAnimationFrame ||
            function (callback) {
                setTimeout(callback, minMsThreshold);
            };
    },

    getTimeBasedId = () => {
        if (getTimeBasedId.__lastTime === new Date().getTime()) {
            return (getTimeBasedId.__lastTime).toString() + (getTimeBasedId.__id++).toString();
        }

        getTimeBasedId.__id = 0;
        getTimeBasedId.__lastTime = new Date().getTime();
        return (getTimeBasedId.__lastTime).toString() + (getTimeBasedId.__id++).toString();
    },
    pullableRecent = (nodes, fn) => {
        let nFn = () => {
            fn(...nodes.map((node) => {
                const
                    hist = node.history,
                    l = hist.length - 1;
                return [hist[l - 1 < 0 ? 0 : l - 1], hist[l]];
            }));
        };
        nFn.__id = getTimeBasedId();
        return nFn;
    },
    pullableEnd = (nodes, fn) => {
        let nFn = () => {
            fn(...nodes.map((node) => {
                const hist = node.history;
                return [hist[0], hist[hist.length - 1]];
            }));
        };
        nFn.__id = getTimeBasedId();
        return nFn;
    },
    unique = fns => fns
                    .reduce((store, fn) => {
                // @warn function with side effect, it mutates the store passed during initialization
                        if (fn.__id in store.map) {
                            return store;
                        }

                        store.map[fn.__id] = 1;
                        store.unique.push(fn);

                        return store;
                    }, { map: {}, unique: [] })
                    .unique,
    compose = fns => () => {
        fns.forEach(fn => fn());
    },
    flat = (params) => {
        const res = [];
        params.forEach(param => res.push(...param));
        return res;
    },
    identityMap = arrays => arrays,
    splitPathProp = (path) => {
        const pathArr = path.split('.'),
            len = pathArr.length;
        return [pathArr.slice(0, len - 1), pathArr[len - 1]];
    },
    scheduler = (onFinishCallback, isPrintMode) => {
        let queue = [],
            animationFrame = null;

        onFinishCallback = onFinishCallback &&
            typeof onFinishCallback === 'function' && onFinishCallback || (() => { });

        return (listeners, payload) => {
            [].push.apply(queue, listeners);
            if (animationFrame === null) {
                animationFrame = reqAnimFrame(isPrintMode)(() => {
                    const tempQ = queue.slice(0);
                    queue.length = 0;
                    animationFrame = null;

                    unique(tempQ).forEach(fn => fn());
                    onFinishCallback(payload);
                });
            }
        };
    },
    fetch = namedNode => (...params) => params.map((param) => {
        const node = namedNode[param];
        return {
            name: node.name,
            qualifiedName: node.qualifiedName,
            value: node.seed
        };
    }),
    fetchAggregator = (...params) => ({
        dependencies: params.slice(0, params.length - 1),
        fn: params[params.length - 1]
    }),
    getUpstreamNodes = (list) => {
        let res = [];
        const map = {};
        list.forEach(node => map[node.qualifiedName] = -1);
        function rec (arr) {
            arr.forEach((node) => {
                let qname,
                    placedIndex,
                    preArr,
                    postArr;
                if (!((qname = node.qualifiedName) in map)) {
                    map[qname] = res.push(node) - 1;
                } else {
                    placedIndex = map[qname];
                    if (placedIndex !== -1 && placedIndex !== res.length - 1) {
                        // If not the last element, readjust the array so that the later dependency position is saved
                        preArr = res.slice(0, placedIndex);
                        postArr = res.slice(placedIndex + 1);
                        res = preArr.concat(postArr);

                        // reset the index in map
                        postArr.forEach((elem, i) => map[elem.qualifiedName] = i + preArr.length);
                        map[qname] = res.push(node) - 1;
                    }
                }
                rec(node.outgoingEdges);
            });
        }
        rec(list);
        return res;
    },
    resolver = {
        accumulate: (...params) => {
            const resp = {};
            params.forEach((nodeDetails) => {
                Object.assign(resp, { [nodeDetails.name]: nodeDetails.value });
            });
            return resp;
        },
        identity: nodeDetails => nodeDetails.value
    };

function resolveDependencyOrder (node, resolved, resolveMap) {
    let qname;
    node.edges.forEach((neighbour) => {
        resolveDependencyOrder(neighbour, resolved, resolveMap);
    });

    if (node.isRoot() || (qname = node.qualifiedName) in resolveMap) {
        return;
    }
    resolved.push(node);
    resolveMap[qname] = 1;
}

function shallowMerge(target, ...varArgs) {
    if (target == null) { // TypeError if undefined or null
        throw new TypeError('Cannot convert undefined or null to object');
    }

    let to = Object(target);

    for (let index = 0; index < varArgs.length; index++) {
        let nextSource = varArgs[index];

        if (nextSource != null) { // Skip over if undefined or null
            for (let nextKey in nextSource) {
                // Avoid bugs when hasOwnProperty is shadowed
                if (Object.prototype.hasOwnProperty.call(nextSource, nextKey)) {
                    to[nextKey] = nextSource[nextKey];
                }
            }
        }
    }
    return to;
}

class CustomResolver {
    constructor (resolver) {
        this.fn = resolver;
        this.dep = [];
    }

    addDependencies(...dep) {
        this.dep.push(...dep);
        return this;
    }

    getDependencies () {
        return this.dep;
    }

    get () {
        return this.fn;
    }
}

export {
    shallowMerge,
    isSimpleObject,
    scheduler,
    compose,
    flat,
    identityMap,
    pullableEnd,
    pullableRecent,
    unique,
    splitPathProp,
    resolver,
    ForeignSet,
    resolveDependencyOrder,
    fetch,
    fetchAggregator,
    CustomResolver,
    getUpstreamNodes
};
