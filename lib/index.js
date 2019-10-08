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
  let lastVisitedNode = [[entryNode, 'normal']];
  walker(astNode, {
    ExpressionStatement(node, recurse) {
      recurse(node.expression);
    },
    FunctionDeclaration() {},
    FunctionExpression() {},
    ArrowFunctionExpression() {},
    ArrayExpression(node, recurse) {
      for (let i = 0; i < node.elements.length; i++) {
        recurse(node.elements[i]);
      }
      connectNode(node.cfg);
      lastVisitedNode.push([node.cfg, 'normal']);
    },
    AssignmentExpression(node, recurse) {
      recurse(node.right);
      connectNode(node.cfg);
      lastVisitedNode.push([node.cfg, 'normal']);
    },
    UnaryExpression(node, recurse) {
      recurse(node.argument);
      connectNode(node.cfg);
      lastVisitedNode.push([node.cfg, 'normal']);
    },
    BinaryExpression(node, recurse) {
      // TODO: Order must be checked
      recurse(node.left);
      recurse(node.right);
      connectNode(node.cfg);
      lastVisitedNode.push([node.cfg, 'normal']);
    },
    LogicalExpression(node, recurse) {
      if (node.operator === '&&') {
        recurse(node.left);
        const leftCfgNode = lastVisitedNode.pop();
        leftCfgNode[1] = 'true';
        lastVisitedNode.push(leftCfgNode);
        recurse(node.right);
        const rightCfgNode = lastVisitedNode.pop();
        leftCfgNode[1] = 'false';
        rightCfgNode[1] = 'normal';
        lastVisitedNode.push(leftCfgNode);
        lastVisitedNode.push(rightCfgNode);
        connectNode(node.cfg);
        lastVisitedNode.push([node.cfg, 'normal']);
      } else {
        recurse(node.left);
        const leftCfgNode = lastVisitedNode.pop();
        leftCfgNode[1] = 'false';
        lastVisitedNode.push(leftCfgNode);
        recurse(node.right);
        const rightCfgNode = lastVisitedNode.pop();
        leftCfgNode[1] = 'true';
        rightCfgNode[1] = 'normal';
        lastVisitedNode.push(leftCfgNode);
        lastVisitedNode.push(rightCfgNode);
        connectNode(node.cfg);
        lastVisitedNode.push([node.cfg, 'normal']);
      }
    },
    IfStatement(node, recurse) {
      recurse(node.test);
      const testCfgNode = lastVisitedNode.pop();
      testCfgNode[1] = 'true';
      lastVisitedNode.push(testCfgNode);
      recurse(node.consequent);
      if (node.alternate !== null) {
        const consequentCfgNode = lastVisitedNode.pop();
        testCfgNode[1] = 'false';
        lastVisitedNode.push(testCfgNode);
        recurse(node.alternate);
        lastVisitedNode.push(consequentCfgNode);
      }
    },
    ConditionalExpression(node, recurse) {
      recurse(node.test);
      const testCfgNode = lastVisitedNode.pop();
      testCfgNode[1] = 'true';
      lastVisitedNode.push(testCfgNode);
      recurse(node.consequent);
      const consequentCfgNode = lastVisitedNode.pop();
      testCfgNode[1] = 'false';
      lastVisitedNode.push(testCfgNode);
      recurse(node.alternate);
      lastVisitedNode.push(consequentCfgNode);
      connectNode(node.cfg);
      lastVisitedNode.push([node.cfg, 'normal']);
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
      console.log(node);
      connectNode(node.cfg);
      lastVisitedNode.push([node.cfg, 'normal']);
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
  function connectNode(flowNode) {
    while (lastVisitedNode.length !== 0) {
      const [node, edge] = lastVisitedNode.pop();
      node.connect(flowNode, edge);
    }
    lastVisitedNode = [];
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
    let target;
    switch (astNode.type) {
      case 'BreakStatement':
        target = getJumpTarget(astNode, breakTargets);
        return target ? getSuccessor(target) : exitNode;

      case 'ContinueStatement':
        target = getJumpTarget(astNode, continueTargets);

        switch (target.type) {
          case 'ForStatement':
            // continue goes to the update, test or body
            return (
              (target.update && target.update.cfg) ||
              (target.test && target.test.cfg) ||
              getEntry(target.body)
            );
          case 'ForInStatement':
            return target.cfg;
          case 'DoWhileStatement':
          /* falls through */
          case 'WhileStatement':
            return target.test.cfg;
          default:
        }

      // unreached
      /* falls through */
      case 'BlockStatement':
      /* falls through */
      case 'Program':
        return (astNode.body.length && getEntry(astNode.body[0])) || getSuccessor(astNode);

      case 'DoWhileStatement':
        return getEntry(astNode.body);

      case 'EmptyStatement':
        return getSuccessor(astNode);

      case 'ForStatement':
        return (
          (astNode.init && astNode.init.cfg) ||
          (astNode.test && astNode.test.cfg) ||
          getEntry(astNode.body)
        );

      case 'FunctionDeclaration':
        return getSuccessor(astNode);

      case 'IfStatement':
        return astNode.test.cfg;
      case 'SwitchStatement':
        return getEntry(astNode.cases[0]);

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
