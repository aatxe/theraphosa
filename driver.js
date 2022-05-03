var editor = ace.edit('code')
editor.session.setMode("ace/mode/python")
editor.setTheme('ace/theme/monokai')
editor.setOptions({
  tabSize: 2,
  minLines: 20,
  maxLines: 30,
})

var currentWat
var outputLog
var outputBase64
var binaryBuffer = null

var features = {
  exceptions: true,
  mutable_globals: true,
  reference_types: true
}

var submitBtn = $('#submit')
var compiledWat = $("#compiled-wat")
var outputArea = $('#output')

const TRU_VAL = -1n
const FLS_VAL = 0x7FFFFFFFFFFFFFFFn
const NIL_VAL = 0x100000001n

const ERR_COMP_NOT_NUM     =  1n
const ERR_ARITH_NOT_NUM    =  2n
const ERR_LOGIC_NOT_BOOL   =  3n
const ERR_IF_NOT_BOOL      =  4n
const ERR_OVERFLOW         =  5n
const ERR_GET_NOT_TUPLE    =  6n
const ERR_GET_LOW_INDEX    =  7n
const ERR_GET_HIGH_INDEX   =  8n
const ERR_GET_NOT_NUM      =  9n
const ERR_NIL_DEREF        = 10n
const ERR_OUT_OF_MEMORY    = 11n
const ERR_SET_NOT_TUPLE    = 12n
const ERR_SET_LOW_INDEX    = 13n
const ERR_SET_NOT_NUM      = 14n
const ERR_SET_HIGH_INDEX   = 15n
const ERR_CALL_NOT_CLOSURE = 16n
const ERR_CALL_ARITY_ERR   = 17n
const ERR_SIZE_MISMATCH    = 18n

WabtModule().then(function(wabt) {
  function compile (wat) {
    var binaryOutput

    try {
      var module = wabt.parseWat('test.wast', wat, features)

      module.resolveNames()
      module.validate(features)
      binaryOutput = module.toBinary({ log: true, write_debug_names: true })
      binaryBuffer = binaryOutput.buffer
    } catch (e) {
      outputLog += e.toString()
      outputArea.addClass('alert-danger').removeClass('alert-success')
    } finally {
      if (module) module.destroy()
    }
  }

  function onSubmit (_) {
    submitBtn.prop('disabled', true)
    outputArea.hide()
    compiledWat.hide()
    outputLog = ''

    const source = editor.getValue()
    currentWat = Theraphosa.compile(source)

    if (Theraphosa.errorLog() !== "") {
      outputLog += Theraphosa.errorLog() + '\n'
      outputArea.addClass('alert-danger').removeClass('alert-success')
      outputArea.text(outputLog)
      outputArea.show()
      submitBtn.prop('disabled', false)
      return
    }

    compiledWat.text(currentWat)
    compiledWat.show()
    compile(currentWat)

    var memory = new WebAssembly.Memory({ initial: 1, maximum: 200 })

    function printHelp (snake) {
      console.log('printHelp called on ' + snake)

      if (snake === TRU_VAL) {
        outputLog += 'true'
        return
      }

      if (snake === FLS_VAL) {
        outputLog += 'false'
        return
      }

      if (snake === NIL_VAL) {
        outputLog += 'nil'
        return
      }

      if ((snake & 7n) === 5n) {
        outputLog += '<function>'
        return
      }

      if ((snake & 7n) === 1n) {
        const mem = new BigUint64Array(memory.buffer)
        const tupAddr = (snake >> 3n) / 8n
        console.log('tuple address: ' + tupAddr)
        console.log('tuple length: ' + mem[tupAddr])
        outputLog += '('
        for (var idx = 1n; idx <= mem[tupAddr]; idx++) {
          printHelp(mem[tupAddr + idx])
          if (idx !== mem[tupAddr]) {
            outputLog += ', '
          }
        }
        outputLog += ')'
        return
      }

      if (snake % 2n === 0n) {
        const num = snake >> 1n
        outputLog += num
        return
      }

      outputLog += 'unknown value (' + snake + ')'
    }

    WebAssembly.instantiate(binaryBuffer, {
      runtime: {
        heap: memory,
        print: function (snake) {
          printHelp(snake)
          outputLog += '\n'
          return snake
        },
        equal: function equal (lhs, rhs) {
          // lhs is true
          if (lhs === TRU_VAL) {
            return (rhs === TRU_VAL) ? TRU_VAL : FLS_VAL
          }

          // lhs is false
          if (lhs === FLS_VAL) {
            return (rhs === FLS_VAL) ? TRU_VAL : FLS_VAL
          }

          // lhs is nil
          if (lhs === NIL_VAL) {
            return (rhs === NIL_VAL) ? TRU_VAL : FLS_VAL
          }

          // lhs is a number
          if ((lhs & 1n) === 0) {
            return (rhs === lhs) ? TRU_VAL : FLS_VAL
          }

          // lhs is a closure, so fall back to reference equality
          if ((lhs & 7n) === 5n) {
            return (rhs === lhs) ? TRU_VAL : FLS_VAL
          }

          // lhs is not a tuple, meaning something went very wrong
          if ((lhs & 7n) !== 1n) {
            return NIL_VAL
          }

          const mem = new BigUint64Array(memory.buffer)

          const lhsAddr = (lhs >> 3n) / 8n
          console.log('lhs address: ' + lhsAddr)
          console.log('lhs length: ' + mem[lhsAddr])

          const rhsAddr = (rhs >> 3n) / 8n
          console.log('rhs address: ' + rhsAddr)
          console.log('rhs length: ' + mem[rhsAddr])

          // tuples of unequal length cannot be equal
          if (mem[lhsAddr] !== mem[rhsAddr]) {
            return FLS_VAL
          }

          for (var idx = 1n; idx <= mem[lhsAddr]; idx++) {
            const ans = equal(mem[lhsAddr + idx], mem[rhsAddr + idx])
            if (ans !== TRU_VAL) {
              return ans
            }
          }

          return TRU_VAL
        },
        error: function (snake, errCode) {
          switch (errCode) {
            case ERR_COMP_NOT_NUM:
              outputLog += 'ERROR: comparison expected a number, got '
              printHelp(snake)
              outputLog += '\n'
              break
            case ERR_ARITH_NOT_NUM:
              outputLog += 'ERROR: arithmetic expected a number, got '
              printHelp(snake)
              outputLog += '\n'
              break
            case ERR_LOGIC_NOT_BOOL:
              outputLog += 'ERROR: logic expected a boolean, got '
              printHelp(snake)
              outputLog += '\n'
              break
            case ERR_IF_NOT_BOOL:
              outputLog += 'ERROR: if expected a boolean, got '
              printHelp(snake)
              outputLog += '\n'
              break
            case ERR_OVERFLOW:
              outputLog += 'ERROR: integer overflow, got '
              printHelp(snake)
              outputLog += '\n'
              break
            case ERR_GET_NOT_TUPLE:
              outputLog += 'ERROR: get expected tuple, got '
              printHelp(snake)
              outputLog += '\n'
              break
            case ERR_GET_LOW_INDEX:
              outputLog += 'ERROR: index too small to get, got '
              printHelp(snake)
              outputLog += '\n'
              break
            case ERR_GET_HIGH_INDEX:
              outputLog += 'ERROR: index too large to get, got '
              printHelp(snake)
              outputLog += '\n'
              break
            case ERR_GET_NOT_NUM:
              outputLog += 'ERROR: get expected numeric index, got '
              printHelp(snake)
              outputLog += '\n'
              break
            case ERR_SET_NOT_TUPLE:
              outputLog += 'ERROR: set expected tuple, got '
              printHelp(snake)
              outputLog += '\n'
              break
            case ERR_SET_LOW_INDEX:
              outputLog += 'ERROR: index too small to set, got '
              printHelp(snake)
              outputLog += '\n'
              break
            case ERR_SET_HIGH_INDEX:
              outputLog += 'ERROR: index too large to set, got '
              printHelp(snake)
              outputLog += '\n'
              break
            case ERR_SET_NOT_NUM:
              outputLog += 'ERROR: set expected numeric index, got '
              printHelp(snake)
              outputLog += '\n'
              break
            case ERR_CALL_NOT_CLOSURE:
              outputLog += 'ERROR: tried to call a non-closure value: '
              printHelp(snake)
              outputLog += '\n'
              break
            case ERR_SIZE_MISMATCH:
              outputLog += 'ERROR: tuple failed size assertion: '
              printHelp(snake)
              outputLog += '\n'
              break
            case ERR_NIL_DEREF:
              outputLog += 'ERROR: tried to access component of nil\n'
              break
            case ERR_OUT_OF_MEMORY:
              outputLog += 'ERROR: out of memory\n'
              break
            case ERR_CALL_ARITY_ERR:
              outputLog += 'ERROR: arity mismatch in call\n'
              break
            default:
              outputLog += 'ERROR: unknown error code: ' + errCode + ', val: '
              printHelp(snake)
              outputLog += '\n'
          }
          throw errCode
        }
      }
    }).then(_ => {
      outputArea.addClass('alert-success').removeClass('alert-danger')
      outputArea.text(outputLog)
      outputArea.show()
    }).catch(_ => {
      outputArea.addClass('alert-danger').removeClass('alert-success')
      outputArea.text(outputLog)
      outputArea.show()
    })

    submitBtn.prop('disabled', false)
  }

  document.getElementById('submit').addEventListener('click', onSubmit)

  document.getElementById('reset').addEventListener('click', function () {
    binaryBuffer = null
    editor.session.setValue('')
    compiledWat.text('')
    outputArea.removeClass('alert-success').removeClass('alert-danger')
    outputArea.hide()
  })

  document.getElementById('lists-ex').addEventListener('click', function () {
    editor.session.setValue(`def link(first, rest):
  (first, rest)

def length_acc(lst, length_so_far):
  if lst == nil:
    length_so_far
  else:
    length_acc(lst[1], length_so_far + 1)

def length(lst):
  length_acc(lst, 0)

def sum_acc(lst, sum_so_far):
  if lst == nil:
    sum_so_far
  else:
    sum_acc(lst[1], sum_so_far + lst[0])

def sum(lst):
  sum_acc(lst, 0)

def append(lst1, lst2):
  if lst1 == nil:
    lst2
  else:
    link(lst1[0], append(lst1[1], lst2))

def reverse_acc(lst, acc):
  if lst == nil:
    acc
  else:
    reverse_acc(lst[1], link(lst[0], acc))

def reverse(lst):
  reverse_acc(lst, nil)

reverse(link(1, link(2, link(3, nil))))`)
    submitBtn.click()
  })

  document.getElementById('fact-ex').addEventListener('click', function () {
    editor.session.setValue(`def fact(n):
  if n <= 1: 1
  else: n * fact(n - 1)
fact(5)`)
    submitBtn.click()
  })

  document.getElementById('mutrec-ex').addEventListener('click', function () {
    editor.session.setValue(`def even(n):
  if n == 0: true
  else: if n == 1: false
  else: odd(n - 1)
and def odd(n):
  if n == 1: true
  else: even(n - 1)
even(4)`)
    submitBtn.click()
  })
})
