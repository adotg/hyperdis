import {
    isSimpleObject,
    resolver,
    // upstreamNodes,
    flat,
    resolveDependencyOrder,
    getUpstreamNodes,
    ForeignSet,
    fetch,
    CustomResolver,
    scheduler,
    shallowMerge
} from './utils';
import Node from './graph-node';
import ElectricNode from './electric-node';

export default class Graph {
    constructor (options) {
        options = shallowMerge({}, { isPrintMode: false }, options);
        this.qualifiedNodeMap = {};
        this.retriever = fetch(this.qualifiedNodeMap);
        this.root = new Node(null, null, { retriever: this.retriever });
        this.root.resolver = resolver.accumulate;

        this._wholeSet = null;
        this._propagate = true;
        this.propagationOverride = {
            currentFrameListeners: false,
            nextFrameListeners: false
        };

        this._schedule = scheduler((payload) => {
            let qname;
            for (qname in payload.flushTarget) {
                if (!({}).hasOwnProperty.call(this.qualifiedNodeMap, qname)) {
                    return;
                }
                this.qualifiedNodeMap[qname].flush();
            }
        }, options.isPrintMode);
    }

    createNodesFrom (obj, mount) {
        let val,
            resolveReqList;
        const qualifiedNodeMap = this.qualifiedNodeMap,
            root = this.root,
            retriever = this.retriever;

        (function rec (objn, qualifiedName, history) {
            let key,
                qname,
                perv,
                node;

            for (key in objn) {
                if (!({}).hasOwnProperty.call(objn, key)) {
                    continue;
                }
                qname = `${qualifiedName}${key}`;
                node = new Node(key, qname, { retriever });
                qualifiedNodeMap[qname] = node;

                if ((perv = history.perv) !== undefined) {
                    perv.addDependencies(node);
                } else {
                    // top most level entries
                    root.addDependencies(node);
                }

                if (isSimpleObject(val = objn[key])) {
                    rec(val, `${qualifiedName}${key}.`, { perv: node });
                    node.resolver = resolver.accumulate;
                } else if (val instanceof CustomResolver) {
                    node.resolver = val.get();
                    node.addDependencies(...val.getDependencies().map(qname => qualifiedNodeMap[qname]));
                } else {
                    node.resolver = resolver.identity;
                    node.seed = val;
                    // node.resolve();
                }
            }
        }(obj, mount === null ? '' : `${mount}.`, {
            perv: qualifiedNodeMap[mount]
        }));

        this._wholeSet = new ForeignSet(Object.keys(this.qualifiedNodeMap));

        // Recalculate the model without firing the listeners
        // @todo selective branch resolve. Currently resolve gets called even for a branch which was updated
        resolveReqList = this.constructor.getResolvedList(root).concat(root).filter(node => node.requireResolve);
        resolveReqList.forEach(node => node.resolve());
        getUpstreamNodes(resolveReqList).forEach(node => node.resolve());
        return this;
    }

    getNodeValue (prop) {
        if (prop in this.qualifiedNodeMap) {
            return this.qualifiedNodeMap[prop].seed;
        }
        return undefined;
    }

    createElectricNodeOf (props, fnSpec) {
        const nodes = props.map(prop => this.qualifiedNodeMap[prop]),
            eNode = new ElectricNode().addEdges(...nodes);

        nodes.forEach(node => node.addElectricNode(eNode));
        return eNode[`regListenerFor${fnSpec.type}`](fnSpec.fn);
    }

    update (params) {
        let changedSet,
            upstreamNodes;
        const
            electricEdges = [],
            nodes = params.map((entry) => {
                entry[0].seed = entry[1];
                return entry[0];
            });
        nodes.forEach(node => node.resolve());
        for (let val of flat(nodes.map(node => node.electricEdges))) {
            electricEdges.push(val);
        }
        changedSet = new ForeignSet(nodes.map(node => node.qualifiedName));

        if (!this._propagate) {
            this.__execUniqueElectricEdges(electricEdges);
            this._propagate = true;
            return this;
        }

        upstreamNodes = getUpstreamNodes(nodes);
        upstreamNodes.forEach(upstreamNode => upstreamNode.resolve());
        changedSet.append(upstreamNodes.map(node => node.qualifiedName));
        for (let val of flat(upstreamNodes.map(node => node.electricEdges))) {
            electricEdges.push(val);
        }

        this.__execUniqueElectricEdges(Array.from(new Set(electricEdges)), changedSet);
        return this;
    }

    __execUniqueElectricEdges (electricEdges, changedSet) {
        const
            cfLstnrs = [], // current frame listeners
            nfLstnrs = []; // next frame listeners
        if (changedSet) {
            const
                differenceSet = ForeignSet.difference(this._wholeSet, changedSet),
                entries = differenceSet.toArray();

            entries.forEach(entry => this.qualifiedNodeMap[entry].repeatHead());
        }

        electricEdges.forEach((e) => {
            cfLstnrs.push(...e.listeners.currentFrame);
        });
        electricEdges.forEach((e) => {
            nfLstnrs.push(...e.listeners.nextFrame);
        });

        !this.propagationOverride.currentFrameListeners && cfLstnrs.forEach(fn => fn());
        !this.propagationOverride.nextFrameListeners && this._schedule(nfLstnrs, { flushTarget: changedSet });
        this.resetPropagationOverride();
        return this;
    }

    resetNodeValue (...qnames) {
        const nodes = qnames.map(qname => this.qualifiedNodeMap[qname]),
            args = nodes.map(node => [node, node.seed]);
        this.update(args);
        return this;
    }

    static getResolvedList (node) {
        const resolved = [];
        resolveDependencyOrder(node, resolved, {});
        return resolved;
    }

    stopPropagation () {
        this._propagate = false;
        return this;
    }

    resetPropagationOverride () {
        this.propagationOverride.currentFrameListeners = false;
        this.propagationOverride.nextFrameListeners = false;
        return this;
    }

    setPropagationOverride (key) {
        this.propagationOverride[`${key}Listeners`] = true;
        return this;
    }

    getNodeFromQualifiedName (qname) {
        return this.qualifiedNodeMap[qname];
    }
}
