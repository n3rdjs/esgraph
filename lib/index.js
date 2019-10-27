const walker = require('walkes');

// FIXME: switch/case with default before other cases?'
// FIXME: catch creates a new scope, so should somehow be handled differently

// TODO: try/finally: finally follows try, but does not return to normal flow?

// TODO: labeled break/continue
// TODO: WithStatement

// TODO: avoid adding and deleting properties on ast nodes

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
  const catchStack = [[exitNode]];
  const entryNode = new FlowNode(astNode, undefined, 'entry');


  createNodes(astNode);
  
  const lastVisitedNode = [[entryNode, 'normal']];
  const lastBreakNode = [];
  const lastContinueNode = [];
  const labelStack = [];

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
      lastVisitedNode.push(...popLastContinueNode(findLabel(node)));
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
      lastVisitedNode.push(...popLastBreakNode(findLabel(node)));
    },
    ForInStatement(node, recurse) {
      recurse(node.right);
      recurse(node.left);
      connectNode(node.cfg);
      pushLastVisitedNode(node.cfg, 'true');
      recurse(node.body);
      lastVisitedNode.push(...popLastContinueNode(findLabel(node)));
      connectNode(node.cfg);
      pushLastVisitedNode(node.cfg, 'false');
      lastVisitedNode.push(...popLastBreakNode(findLabel(node)));
    },
    ForOfStatement(node, recurse) {
      recurse(node.right);
      recurse(node.left);
      connectNode(node.cfg);
      pushLastVisitedNode(node.cfg, 'true');
      recurse(node.body);
      lastVisitedNode.push(...popLastContinueNode(findLabel(node)));
      connectNode(node.cfg);
      pushLastVisitedNode(node.cfg, 'false');
      lastVisitedNode.push(...popLastBreakNode(findLabel(node)));
    },
    SwitchStatement(node, recurse) {
      recurse(node.discriminant);
      for (const eachcase of node.cases) {
        recurse(eachcase);
      }
      lastVisitedNode.push(...popLastBreakNode(null));
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
      lastVisitedNode.push(...popLastContinueNode(findLabel(node)));
      connectNode(getEntry(node.test));
      popAllLastVisitedNode();
      markAllLastVisitedNode('false', testNode);
      lastVisitedNode.push(...testNode);
      lastVisitedNode.push(...popLastBreakNode(findLabel(node)));
    },
    DoWhileStatement(node, recurse) {
      recurse(node.body);
      recurse(node.test);
      const testNode = copyAllLastVisitedNode();
      markAllLastVisitedNode('true');
      lastVisitedNode.push(...popLastContinueNode(findLabel(node)));
      markAllLastVisitedNode('false', testNode);
      lastVisitedNode.push(...testNode);
      lastVisitedNode.push(...popLastBreakNode(findLabel(node)));
    },
    BreakStatement(node, recurse) {
      lastBreakNode.push(...popAllLastVisitedNode().map((a) => { 
        a.push(node.label); return a;
      }));
    },
    ContinueStatement(node, recurse) {
      lastContinueNode.push(...popAllLastVisitedNode().map((a) => {
        a.push(node.label); return a;
      }));
    },
    LabeledStatement(node, recurse) {
      labelStack.push(node);
      recurse(node.body);
      labelStack.pop();
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
      lastVisitedNode.push(...popLastBreakNode(findLabel(node)));
    },
    ReturnStatement(node, recurse) {
      recurse(node.argument);
      connectNode(node.cfg);
      node.cfg.connect(exitNode, 'normal');
    },
    CallExpression(node, recurse) {
      recurse(node.callee);
      for (const argument of node.arguments) {
        recurse(argument);
      }
      catchStack[catchStack.length - 1].push([node.cfg, 'exception']);
      connectNode(node.cfg);
      pushLastVisitedNode(node.cfg, 'normal');
    },
    TryStatement(node, recurse) {
      catchStack.push([node]);
      recurse(node.block);
      const exceptionNode = catchStack.pop().slice(1);
      const tryblockLastVisitedNode = popAllLastVisitedNode();
      lastVisitedNode.push(...exceptionNode);
      recurse(node.handler);
      lastVisitedNode.push(...tryblockLastVisitedNode);
      recurse(node.finalizer);
    },
    CatchClause(node, recurse) {
      recurse(node.param);
      recurse(node.body);
    },
    ThrowStatement(node, recurse) {
      recurse(node.argument);
      connectNode(node.cfg);
      catchStack[catchStack.length - 1].push([node.cfg, 'exception']);
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
  lastVisitedNode.push(...catchStack.pop().slice(1));
  connectNode(exitNode);

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

  function popLastBreakNode(label) {
    if (label === null) {
      label = {};
      label.name = null;
    }
    const ret = [];
    for (let i = 0; i < lastBreakNode.length;) {
      if (!(lastBreakNode[i][2] instanceof Object) || lastBreakNode[i][2].name === label.name) {
        ret.push(lastBreakNode[i]);
        lastBreakNode.splice(i, 1);
      } else i++;
    }
    return ret;
  }
  function popLastContinueNode(label) {
    if (label === null) {
      label = {};
      label.name = null;
    }
    const ret = [];
    for (let i = 0; i < lastContinueNode.length;) {
      if (!(lastContinueNode[i][2] instanceof Object) || lastContinueNode[i][2].name === label.name) {
        ret.push(lastContinueNode[i]);
        lastContinueNode.splice(i, 1);
      } else i++;
    }
    return ret;
  }

  function findLabel(node) {
    for (let i = labelStack.length - 1; i >= 0; i--) {
      if (labelStack[i].body === node) {
        return labelStack[i].label;
      }
    }
    return null;
  }

  function markAllLastVisitedNode(label, list = lastVisitedNode) {
    for (const node of list) {
      node[1] = label;
    }
  }

  function pushLastVisitedNode(node, label) {
    lastVisitedNode.push([node, label]);
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

  return [entryNode, exitNode, allNodes];
}

module.exports = ControlFlowGraph;
module.exports.dot = require('./dot');
