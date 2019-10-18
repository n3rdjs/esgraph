const walker = require('walkes');

// FIXME: switch/case with default before other cases?'
// FIXME: catch creates a new scope, so should somehow be handled differently

// TODO: try/finally: finally follows try, but does not return to normal flow?

// TODO: labeled break/continue
// TODO: WithStatement

// TODO: avoid adding and deleting properties on ast nodes

const continueTargets = ['ForStatement', 'ForInStatement', 'DoWhileStatement', 'WhileStatement'];
const breakTargets = continueTargets.concat(['SwitchStatement']);
const throwTypes = [
  'AssignmentExpression', // assigning to undef or non-writable prop
  'BinaryExpression', // instanceof and in on non-objects
  'CallExpression', // obviously
  'MemberExpression', // getters may throw
  'NewExpression', // obviously
  'UnaryExpression', // delete non-deletable prop
];

class FlowNode {
  constructor(astNode, parent, type) {
    this.astNode = astNode;
    this.parent = parent;
    this.type = type;
    this.prev = [];
  }

  connect(next, type) {
    this[type || 'normal'] = next;
    return this;
  }
}

/**
 * Returns [entry, exit] `FlowNode`s for the passed in AST
 */
function ControlFlowGraph(astNode) {
  const parentStack = [];
  const exitNode = new FlowNode(undefined, undefined, 'exit');
  const catchStack = [exitNode];

  const entryNode = new FlowNode(astNode, undefined, 'entry');


  createNodes(astNode);
  linkSiblings(astNode);
  const lastVisitedNode = [[entryNode, 'normal']];
  const lastBreakNode = [];
  const lastContinueNode = [];

  walker(astNode, {
    ExpressionStatement(node, recurse) {
      recurse(node.expression);
    },
    FunctionDeclaration() {},
    FunctionExpression() {},
    ArrowFunctionExpression() {},
    ArrayExpression(node, recurse) {
      for (const element of node.elements) {
        recurse(element);
      }
      connectNode(node.cfg);
      pushLastVisitedNode(node.cfg, 'normal');
    },
    AssignmentExpression(node, recurse) {
      recurse(node.right);
      connectNode(node.cfg);
      pushLastVisitedNode(node.cfg, 'normal');
    },
    UnaryExpression(node, recurse) {
      recurse(node.argument);
      connectNode(node.cfg);
      pushLastVisitedNode(node.cfg, 'normal');
    },
    BinaryExpression(node, recurse) {
      // TODO: Order must be checked
      recurse(node.left);
      recurse(node.right);
      connectNode(node.cfg);
      pushLastVisitedNode(node.cfg, 'normal');
    },
    LogicalExpression(node, recurse) {
      if (node.operator === '&&') {
        recurse(node.left);
        const tmp = copyAllLastVisitedNode();
        markAllLastVisitedNode('true');
        recurse(node.right);
        const tmp2 = popAllLastVisitedNode();
        markAllLastVisitedNode('false', tmp);
        markAllLastVisitedNode('normal', tmp2);
        lastVisitedNode.push(...tmp, ...tmp2);
        connectNode(node.cfg);
        pushLastVisitedNode(node.cfg, 'normal');
      } else {
        recurse(node.left);
        const tmp = copyAllLastVisitedNode();
        markAllLastVisitedNode('false');
        recurse(node.right);
        const tmp2 = popAllLastVisitedNode();
        markAllLastVisitedNode('true', tmp);
        markAllLastVisitedNode('normal', tmp2);
        lastVisitedNode.push(...tmp, ...tmp2);
        connectNode(node.cfg);
        pushLastVisitedNode(node.cfg, 'normal');
      }
    },
    IfStatement(node, recurse) {
      recurse(node.test);
      const testNode = copyAllLastVisitedNode();
      markAllLastVisitedNode('true');
      recurse(node.consequent);
      if (node.alternate !== null) {
        const consequentNode = popAllLastVisitedNode();
        console.log('consequent', consequentNode);
        markAllLastVisitedNode('false', testNode);
        lastVisitedNode.push(...testNode);
        recurse(node.alternate);
        lastVisitedNode.push(...consequentNode);
      } else {
        markAllLastVisitedNode('false', testNode);
        lastVisitedNode.push(...testNode);
      }
      console.log('wow1', lastVisitedNode);
    },
    ConditionalExpression(node, recurse) {
      recurse(node.test);
      const testCfgNode = copyAllLastVisitedNode();
      markAllLastVisitedNode('true');
      recurse(node.consequent);
      const consequentCfgNode = popAllLastVisitedNode();
      markAllLastVisitedNode('false', testCfgNode);
      lastVisitedNode.push(...testCfgNode);
      recurse(node.alternate);
      lastVisitedNode.push(...consequentCfgNode);
      connectNode(node.cfg);
      pushLastVisitedNode(node.cfg, 'normal');
    },
    SequenceExpression(node, recurse) {
      for (const expression of node.expressions) {
        recurse(expression);
      }
      connectNode(node.cfg);
      pushLastVisitedNode(node.cfg, 'normal');
    },
    ForStatement(node, recurse) {
      recurse(node.init);
      recurse(node.test);
      let prev;
      if (node.test !== null) {
        prev = copyAllLastVisitedNode();
        markAllLastVisitedNode('true');
      }
      recurse(node.body);
      lastVisitedNode.push(...lastContinueNode.splice(0, lastContinueNode.length));
      recurse(node.update);
      if (node.test !== null) {
        connectNode(getEntry(node.test));
      } else {
        connectNode(getEntry(node.body));
      }
      popAllLastVisitedNode();
      if (node.test !== null) {
        markAllLastVisitedNode('false', prev);
        lastVisitedNode.push(...prev);
      }
      lastVisitedNode.push(...lastBreakNode.splice(0, lastBreakNode.length));
    },
    ForInStatement(node, recurse) {
      recurse(node.right);
      recurse(node.left);
      connectNode(node.cfg);
      pushLastVisitedNode(node.cfg, 'true');
      recurse(node.body);
      lastVisitedNode.push(...lastContinueNode.splice(0, lastContinueNode.length));
      connectNode(node.cfg);
      pushLastVisitedNode(node.cfg, 'false');
      lastVisitedNode.push(...lastBreakNode.splice(0, lastBreakNode.length));
    },
    ForOfStatement(node, recurse) {
      recurse(node.right);
      recurse(node.left);
      connectNode(node.cfg);
      pushLastVisitedNode(node.cfg, 'true');
      recurse(node.body);
      lastVisitedNode.push(...lastContinueNode.splice(0, lastContinueNode.length));
      connectNode(node.cfg);
      pushLastVisitedNode(node.cfg, 'false');
      lastVisitedNode.push(...lastBreakNode.splice(0, lastBreakNode.length));
    },
    SwitchStatement(node, recurse) {
      recurse(node.discriminant);
      for (const eachcase of node.cases) {
        recurse(eachcase);
      }
      lastVisitedNode.push(...lastBreakNode.splice(0, lastBreakNode.length));
    },
    SwitchCase(node, recurse) {
      if (node.test !== null) {
        let prevNode = [];
        if (connectNode(getEntry(node.test), 'false') !== 0) {
          prevNode = popAllLastVisitedNode();
        }
        recurse(node.test);
        connectNode(node.cfg);
        pushLastVisitedNode(node.cfg, 'true');
        lastVisitedNode.push(...prevNode);
      }
      for (const consequent of node.consequent) {
        recurse(consequent);
      }
      if (node.test !== null) {
        pushLastVisitedNode(node.cfg, 'false');
      }
    },
    WhileStatement(node, recurse) {
      recurse(node.test);
      const testNode = copyAllLastVisitedNode();
      markAllLastVisitedNode('true');
      recurse(node.body);
      lastVisitedNode.push(...lastContinueNode.splice(0, lastContinueNode.length));
      connectNode(getEntry(node.test));
      popAllLastVisitedNode();
      markAllLastVisitedNode('false', testNode);
      lastVisitedNode.push(...testNode);
      lastVisitedNode.push(...lastBreakNode.splice(0, lastBreakNode.length));
    },
    DoWhileStatement(node, recurse) {
      recurse(node.body);
      recurse(node.test);
      const testNode = copyAllLastVisitedNode();
      markAllLastVisitedNode('true');
      lastVisitedNode.push(...lastContinueNode.splice(0, lastContinueNode.length));
      markAllLastVisitedNode('false', testNode);
      lastVisitedNode.push(...testNode);
      lastVisitedNode.push(...lastBreakNode.splice(0, lastBreakNode.length));
    },
    BreakStatement(node, recurse) {
      lastBreakNode.push(...popAllLastVisitedNode());
    },
    ContinueStatement(node, recurse) {
      lastContinueNode.push(...popAllLastVisitedNode());
    },
    LabeledStatement(node, recurse) {
      recurse(node.body);
    },
    VariableDeclaration(node, recurse) {
      for (const declarator of node.declarations) {
        recurse(declarator);
      }
      connectNode(node.cfg);
      pushLastVisitedNode(node.cfg, 'normal');
    },
    VariableDeclarator(node, recurse) {
      recurse(node.init);
      connectNode(node.cfg);
      pushLastVisitedNode(node.cfg, 'normal');
    },
    WithStatement(node, recurse) {
      recurse(node.object);
      recurse(node.body);
    },
    Program(node, recurse) {
      for (let i = 0; i < node.body.length; i++) {
        recurse(node.body[i]);
      }
    },
    BlockStatement(node, recurse) {
      for (let i = 0; i < node.body.length; i++) {
        recurse(node.body[i]);
      }
    },
    default(node, recurse) {
      connectNode(node.cfg);
      pushLastVisitedNode(node.cfg, 'normal');
    },

    /**
    ObjectExpression(node, recurse) {
      for(let i = 0; i < node.property; i++) {
        recurse(node.property[i]);
      }
      connectNode(node.cfg);
      lastVisitedNode.push([node.cfg, 'normal']);
    },
    Property(node, recurse) {
      if (node.computed) {
        recurse(node.key);
      }

    },
    */
    

  });

  const allNodes = [];
  const reverseStack = [entryNode];
  let cfgNode;
  while (reverseStack.length) {
    cfgNode = reverseStack.pop();
    allNodes.push(cfgNode);
    cfgNode.next = [];
    for (const type of ['exception', 'false', 'true', 'normal']) {
      const next = cfgNode[type];

      if (!next) continue;
      if (!cfgNode.next.includes(next)) cfgNode.next.push(next);
      if (!next.prev.includes(cfgNode)) next.prev.push(cfgNode);
      if (!reverseStack.includes(next) && !next.next) reverseStack.push(next);
    }
  }
  function connectNode(flowNode, label) {
    let count = 0;
    for (let i = 0; i < lastVisitedNode.length;) {
      if ((label !== undefined && label === lastVisitedNode[i][1]) || (label === undefined)) {
        const [node, edge] = lastVisitedNode.splice(i, 1)[0];
        node.connect(flowNode, edge);
        count++;
        continue;
      }
      i++;
    }
    return count;
  }

  function copyAllLastVisitedNode() {
    const ret = [];
    for (const node of lastVisitedNode) {
      ret.push([...node]);
    }
    return ret;
  }

  function popAllLastVisitedNode() {
    return lastVisitedNode.splice(0, lastVisitedNode.length);
  }

  function markAllLastVisitedNode(label, list = lastVisitedNode) {
    for (const node of list) {
      node[1] = label;
    }
  }

  function pushLastVisitedNode(node, label) {
    lastVisitedNode.push([node, label]);
  }

  function getExceptionTarget() {
    return catchStack[catchStack.length - 1];
  }

  function mayThrow(node) {
    if (expressionThrows(node)) {
      node.cfg.connect(getExceptionTarget(node), 'exception');
    }
  }
  function expressionThrows(astNode) {
    if (typeof astNode !== 'object' || astNode.type === 'FunctionExpression') return false;

    if (astNode.type && throwTypes.includes(astNode.type)) return true;
    return Object.values(astNode).some((prop) => {
      if (prop instanceof Array) return prop.some(expressionThrows);
      else if (typeof prop === 'object' && prop) return expressionThrows(prop);

      return false;
    });
  }

  function getJumpTarget(astNode, types) {
    let { parent } = astNode.cfg;

    while (!types.includes(parent.type) && parent.cfg.parent) ({ parent } = parent.cfg);

    return types.includes(parent.type) ? parent : null;
  }

  function connectNext(node) {
    mayThrow(node);
    node.cfg.connect(getSuccessor(node));
  }


  /**
   * Returns the entry node of a statement
   */
  function getEntry(astNode) {
    switch (astNode.type) {
      // unreached
      /* falls through */
      case 'BlockStatement':
      /* falls through */
      case 'Program':
        return (astNode.body.length && getEntry(astNode.body[0])) || null;

      case 'DoWhileStatement':
        return getEntry(astNode.body);

      case 'EmptyStatement':
        return null;

      case 'ForStatement':
        return (getEntry(astNode.init) || getEntry(astNode.test) || getEntry(astNode.body) || getEntry(astNode.update) || null);

      case 'IfStatement':
        return getEntry(astNode.test);

      case 'SwitchStatement':
        return getEntry(astNode.test);

      case 'TryStatement':
        return getEntry(astNode.block);

      case 'WhileStatement':
        return astNode.test.cfg;

      default:
        return astNode.cfg;
    }
  }

  function extendExpression(flowNode) {
    switch (flowNode.astNode.type) {
      case 'AssignmentExpression':
        return extendExpression(flowNode.astNode.right.cfg);
      case 'ExpressionStatement':
        return extendExpression(flowNode.astNode.expression.cfg);
      default:
        return flowNode;
    }
  }

  /**
   * Returns the successor node of a statement
   */
  function getSuccessor(astNode) {
    // part of a block -> it already has a nextSibling
    if (astNode.cfg.nextSibling) return extendExpression(astNode.cfg.nextSibling);
    const { parent } = astNode.cfg;
    // it has no parent -> exitNode
    if (!parent) return exitNode;

    switch (parent.type) {
      case 'DoWhileStatement':
        return parent.test.cfg;

      case 'ForStatement':
        return (
          (parent.update && parent.update.cfg) ||
          (parent.test && parent.test.cfg) ||
          getEntry(parent.body)
        );

      case 'ForInStatement':
        return parent.cfg;

      case 'TryStatement':
        return (
          (parent.finalizer && astNode !== parent.finalizer && getEntry(parent.finalizer)) ||
          getSuccessor(parent)
        );

      case 'SwitchCase': {
        // the sucessor of a statement at the end of a case block is
        // the entry of the next cases consequent
        if (!parent.cfg.nextSibling) return getSuccessor(parent);

        let check = parent.cfg.nextSibling.astNode;

        while (!check.consequent.length && check.cfg.nextSibling) {
          check = check.cfg.nextSibling.astNode;
        }

        // or the next statement after the switch, if there are no more cases
        return (
          (check.consequent.length && getEntry(check.consequent[0])) || getSuccessor(parent.parent)
        );
      }

      case 'WhileStatement':
        return parent.test.cfg;
      case 'AssignmentExpression':
        return parent.cfg;
      default:
        return getSuccessor(parent);
    }
  }

  /**
   * Creates a FlowNode for every AST node
   */
  function createNodes(astNode) {
    walker(astNode, {
      default(node, recurse) {
        const parent = parentStack.length ? parentStack[parentStack.length - 1] : undefined;
        createNode(node, parent);
        parentStack.push(node);
        walker.checkProps(node, recurse);
        parentStack.pop();
      },
    });
  }
  function createNode(astNode, parent) {
    if (!astNode.cfg) {
      Object.defineProperty(astNode, 'cfg', {
        value: new FlowNode(astNode, parent),
        configurable: true,
      });
    }
  }

  /**
   * Links in the next sibling for nodes inside a block
   */
  function linkSiblings(astNode) {
    function backToFront(list, recurse) {
      // link all the children to the next sibling from back to front,
      // so the nodes already have .nextSibling
      // set when their getEntry is called
      for (const [i, child] of Array.from(list.entries()).reverse()) {
        if (i < list.length - 1) child.cfg.nextSibling = getEntry(list[i + 1]);
        recurse(child);
      }
    }
    function BlockOrProgram(node, recurse) {
      backToFront(node.body, recurse);
    }
    walker(astNode, {
      BlockStatement: BlockOrProgram,
      Program: BlockOrProgram,
      FunctionDeclaration() {},
      FunctionExpression() {},
      SwitchCase(node, recurse) {
        backToFront(node.consequent, recurse);
      },
      SwitchStatement(node, recurse) {
        backToFront(node.cases, recurse);
      },
    });
  }
  return [entryNode, exitNode, allNodes];
}

module.exports = ControlFlowGraph;
module.exports.dot = require('./dot');
