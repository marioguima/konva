import type { Context } from '../Context.ts'
import { Factory } from '../Factory.ts'
import { _registerNode } from '../Global.ts'
import { Shape } from '../Shape.ts'
import type { ShapeConfig } from '../Shape.ts'
import type { GetSet } from '../types.ts'
import { Util } from '../Util.ts'
import { getNumberOrAutoValidator, getNumberValidator, getBooleanValidator, getStringValidator } from '../Validators.ts'

let dummyContext: Context & CanvasRenderingContext2D
function getDummyContext() {
  if (dummyContext) {
    return dummyContext
  }
  dummyContext = Util.createCanvasElement().getContext('2d') as any
  return dummyContext
}

function normalizeFontFamily(fontFamily: string) {
  return fontFamily
    .split(',')
    .map((family) => {
      family = family.trim();
      const hasSpace = family.indexOf(' ') >= 0;
      const hasQuotes = family.indexOf('"') >= 0 || family.indexOf("'") >= 0;
      if (hasSpace && !hasQuotes) {
        family = `"${family}"`;
      }
      return family;
    })
    .join(', ');
}

export interface TextStyle {
  start: number // start position of the style
  end?: number // end position of the style, if undefined it means until the end
  fontFamily: string
  fontSize: number
  fontStyle: 'normal' | 'italic' | 'bold' | 'italic bold' | 'bold italic'
  fontVariant: 'normal' | 'small-caps'
  textDecoration: '' | 'underline' | 'line-through' | 'underline line-through'
  fill: string
  stroke: string
}

type TextPart = {
  text: string
  width: number
  style: Omit<TextStyle, 'start' | 'end'>
}

export interface MultiStyledTextConfig extends ShapeConfig {
  text?: string;
  textStyles?: TextStyle[]
  align?: string;
  verticalAlign?: string;
  padding?: number;
  lineHeight?: number;
  letterSpacing?: number;
  wrap?: string;
  ellipsis?: boolean;
  overflowIndicator?: boolean;
  overflowStroke?: string;
  overflowStrokeWidth?: number;
  backgroundFill?: string;
}

export class MultiStyledText extends Shape<MultiStyledTextConfig> {
  public className = 'MultiStyledText'

  public align!: GetSet<'left' | 'center' | 'right' | 'justify', this>
  public letterSpacing!: GetSet<number, this>
  public verticalAlign!: GetSet<'top' | 'middle' | 'bottom', this>
  public padding!: GetSet<number, this>
  public lineHeight!: GetSet<number, this>
  public text!: GetSet<string, this>
  public textStyles!: GetSet<TextStyle[], this>
  public wrap!: GetSet<'word' | 'char' | 'none', this>
  public ellipsis!: GetSet<boolean, this>
  public overflowIndicator!: GetSet<boolean, this>
  public overflowStroke!: GetSet<string, this>
  public overflowStrokeWidth!: GetSet<number, this>
  public backgroundFill!: GetSet<string | undefined, this>
  public debugBounds!: GetSet<boolean, this>

  private textLines: {
    width: number
    totalHeight: number
    parts: TextPart[]
  }[] = []
  private linesWidth!: number
  private linesHeight!: number
  private hasOverflowFlag = false

  // used when drawing
  private drawState!: {
    x: number
    y: number
    text: string
  }

  constructor(config?: MultiStyledTextConfig) {
    super(config)
    // update text data for certain attr changes
    for (const attr of [
      'padding', 'wrap', 'lineHeight', 'letterSpacing', 'textStyles', 'width', 'height', 'text'
    ]) {
      this.on(`${attr}Change.konva`, this.computeTextParts)
    }
    this.computeTextParts()
  }

  private formatFont(part: Pick<TextPart, 'style'>) {
    return `${part.style.fontStyle} ${part.style.fontVariant} ${part.style.fontSize}px ${normalizeFontFamily(part.style.fontFamily)}`
  }

  private measurePart(part: Omit<TextPart, 'width'>) {
    const context = getDummyContext()
    context.save()
    context.font = this.formatFont(part)
    const width = context.measureText(part.text).width
    context.restore()
    return width
  }

  private computeTextParts() {
    this.textLines = []
    this.hasOverflowFlag = false
    const lines = this.text().split('\n')
    const maxWidth = this.attrs.width
    const maxHeight = this.attrs.height
    const hasFixedWidth = maxWidth !== 'auto' && maxWidth !== undefined
    const hasFixedHeight = maxHeight !== 'auto' && maxHeight !== undefined
    const styles = this.textStyles()
    if (!styles || styles.length === 0) {
      throw new Error('MultiStyledText: textStyles is empty. Provide at least one style covering the text.')
    }
    const shouldWrap = this.wrap() !== 'none'
    const wrapAtWord = this.wrap() !== 'char' && shouldWrap
    const shouldAddEllipsis = this.ellipsis()
    const padding = this.padding()
    const availableWidth = hasFixedWidth
      ? Math.max(0, Number(maxWidth) - padding * 2)
      : Number.POSITIVE_INFINITY
    const availableHeight = hasFixedHeight
      ? Math.max(0, Number(maxHeight) - padding * 2)
      : Number.POSITIVE_INFINITY
    const ellipsis = 'XXX'

    const stylesByChar = Array.from(this.text()).map((char, index) => {
      const style = styles.find((style) => index >= style.start && (typeof style.end === 'undefined' || style.end >= index))
      if (!style) {
        throw new Error(`MultiStyledText: missing style for char index ${index}`)
      }
      return {
        char,
        style
      }
    })
    const findParts = (start: number, end: number) => {
      // find matching characters
      const chars = stylesByChar.slice(start, end)
      // group them by style
      const parts: TextPart[] = []
      for (const char of chars) {
        const similarGroupIndex = parts.findIndex((part) => part.style === char.style)
        if (similarGroupIndex === -1) {
          parts.push({ text: char.char, width: 0, style: char.style })
          continue
        }
        parts[similarGroupIndex].text += char.char
      }
      return parts
    }
    const measureSubstring = (start: number, end: number) => {
      return measureParts(findParts(start, end))
    }
    const measurePartWithSpacing = (part: Omit<TextPart, 'width'>) => {
      const base = this.measurePart(part as TextPart)
      const perCharSpacing = this.letterSpacing() * Math.max(part.text.length - 1, 0)
      return base + perCharSpacing
    }
    const measureParts = (parts: TextPart[]) => {
      return parts.reduce((size, part, index) => {
        const widthWithSpacing = measurePartWithSpacing(part)
        part.width = widthWithSpacing
        const interPartSpacing = index === parts.length - 1 ? 0 : this.letterSpacing()
        return size + widthWithSpacing + interPartSpacing
      }, 0)
    }
    const measureHeightParts = (parts: TextPart[]) => {
      // Empty lines still need a height so they render vertical space
      if (parts.length === 0) {
        const baseStyle = styles[0]!
        return baseStyle.fontSize * this.lineHeight()
      }
      return Math.max(...parts.map((part) => {
        return part.style.fontSize * this.lineHeight()
      }))
    }
    const addLine = (width: number, height: number, parts: TextPart[]) => {
      const baseStyle = styles[0]!
      const safeHeight = Number.isFinite(height) ? height : baseStyle.fontSize * this.lineHeight()
      const prospectiveHeight = currentHeight + safeHeight
      const wouldOverflow = prospectiveHeight > availableHeight

      if (hasFixedHeight && wouldOverflow) {
        // console.log('[MultiStyledText] addLine skip', { currentHeight, safeHeight, availableHeight })
        overflowed = true
        truncated = true
        return false
      }

      this.textLines.push({
        width,
        parts: parts.map((part) => {
          part.width = part.width === 0 ? this.measurePart(part) : part.width
          return part
        }),
        totalHeight: safeHeight
      })
      return true
    }

    let overflowed = false
    let truncated = false
    let ellipsisAdded = false
    let currentHeight = 0
    let charCount = 0
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      let line = lines[lineIndex]
      const originalLineLength = line.length
      let lineWidth = measureSubstring(charCount, charCount + line.length)
      let lineHeight = 0

      if (hasFixedWidth && lineWidth > availableWidth) {
        /*
         * if width is fixed and line does not fit entirely
         * break the line into multiple fitting lines
         */
        let cursor = 0
        while (line.length > 0) {
          /*
           * use binary search to find the longest substring that
           * that would fit in the specified width
           */
          var low = 0,
            high = line.length,
            match = '',
            matchWidth = 0
          while (low < high) {
            var mid = (low + high) >>> 1,
              substr = line.slice(0, mid + 1),
              substrWidth = measureSubstring(charCount + cursor, charCount + cursor + mid + 1)
            if (substrWidth <= availableWidth) {
              low = mid + 1
            match = substr
            matchWidth = substrWidth
          } else {
            high = mid
          }
        }
          /*
            * 'low' is now the index of the substring end
            * 'match' is the substring
            * 'matchWidth' is the substring width in px
            */
          if (match) {
            // a fitting substring was found
            if (wrapAtWord) {
              // try to find a space or dash where wrapping could be done
              let wrapIndex: number
              var nextChar = line[match.length]
              var nextIsSpaceOrDash = nextChar === ' ' || nextChar === '-'
              if (nextIsSpaceOrDash && matchWidth <= availableWidth) {
                wrapIndex = match.length
              } else {
                wrapIndex = Math.max(match.lastIndexOf(' '), match.lastIndexOf('-')) + 1
              }
              if (wrapIndex > 0) {
                // re-cut the substring found at the space/dash position
                low = wrapIndex
                match = match.slice(0, low)
                matchWidth = measureSubstring(charCount + cursor, charCount + cursor + low)
              }
            }
            // match = match.trimRight()
            const parts = findParts(charCount + cursor, charCount + cursor + low)
            lineHeight = measureHeightParts(parts)
            const lineWidthMeasured = measureParts(parts)
            const added = addLine(lineWidthMeasured, lineHeight, parts)
            if (!added) {
              break
            }
            currentHeight += lineHeight
            if (
              !shouldWrap ||
              (hasFixedHeight && currentHeight + lineHeight > availableHeight)
            ) {
              const lastLine = this.textLines[this.textLines.length - 1]
              if (lastLine) {
                if (shouldAddEllipsis) {
                  const lastPart = lastLine.parts[lastLine.parts.length - 1]
                  if (!lastPart) {
                    const styleForEllipsis = styles[styles.length - 1]!
                    const width = this.measurePart({ text: ellipsis, style: styleForEllipsis })
                    lastLine.parts.push({
                      text: ellipsis,
                      width,
                      style: styleForEllipsis
                    })
                    lastLine.width = width
                    ellipsisAdded = true
                    overflowed = true
                    break
                  }
                  const baseWidthWithoutLast = lastLine.width - (lastPart ? lastPart.width : 0)
                  const spacingBetween = this.letterSpacing()
                  const lastPartWidthWithEllipsis = measurePartWithSpacing({ ...lastPart, text: `${lastPart.text}${ellipsis}` })
                  const haveSpace = (baseWidthWithoutLast + lastPartWidthWithEllipsis + spacingBetween) < availableWidth
                  if (!haveSpace) {
                    lastPart.text = lastPart.text.slice(0, lastPart.text.length - 3)
                  }
                  lastLine.parts.splice(lastLine.parts.length - 1, 1)
                  lastLine.parts.push({
                    ...lastPart,
                    width: lastPartWidthWithEllipsis,
                    text: `${lastPart.text}${ellipsis}`
                  })
                  overflowed = true
                  ellipsisAdded = true
                }
              }

              /*
                * stop wrapping if wrapping is disabled or if adding
                * one more line would overflow the fixed height
                */
              // if we broke due to width/ellipsis and already accumulated height beyond available, mark truncation
              const nextHeight = currentHeight + (lineHeight || 0)
              if (hasFixedHeight && nextHeight > availableHeight) {
                truncated = true
              }
              break
            }
            line = line.slice(low)
            cursor += low
            // line = line.trimLeft()
            if (line.length > 0) {
              // Check if the remaining text would fit on one line
          const parts = findParts(charCount + cursor, charCount + cursor + line.length)
          lineWidth = measureParts(parts)
          if (lineWidth <= availableWidth) {
            // if it does, add the line and break out of the loop
            const height = measureHeightParts(parts)
            const added = addLine(lineWidth, height, parts)
            if (!added) {
                  break
                }
                currentHeight += height
                break
              }
            }
          } else {
            // not even one character could fit in the element, abort
            overflowed = true
            truncated = true
            break
          }
        }
      } else {
        const parts = findParts(charCount, charCount + line.length)
        lineHeight = measureHeightParts(parts)
        const lineWidthMeasured = measureParts(parts)
        const added = addLine(lineWidthMeasured, lineHeight, parts)
        if (!added) {
          break
        }
        currentHeight += lineHeight
      }

      // account for the newline character that was removed by split()
      const isLastLine = lineIndex === lines.length - 1
      charCount += originalLineLength + (isLastLine ? 0 : 1)
    }

    // If overflow happened and ellipsis is enabled, append ellipsis to last visible line
    if (overflowed && shouldAddEllipsis && hasFixedWidth && this.textLines.length > 0) {
      const lastLine = this.textLines[this.textLines.length - 1]
      const lastPart = lastLine.parts[lastLine.parts.length - 1]
      const styleForEllipsis = lastPart?.style ?? styles[styles.length - 1]!
      const ellipsisWidth = measurePartWithSpacing({ text: ellipsis, style: styleForEllipsis })
      const baseWidthWithoutLast = lastLine.width - (lastPart ? lastPart.width : 0)

      // If there is no part, just add the ellipsis and return
      if (!lastPart) {
        lastLine.parts.push({
          text: ellipsis,
          width: ellipsisWidth,
          style: styleForEllipsis
        })
        lastLine.width = baseWidthWithoutLast + ellipsisWidth
        this.linesWidth = Math.max(...this.textLines.map((line) => line.width, 0))
        this.linesHeight = this.textLines.reduce((size, line) => size + line.totalHeight, 0)
        return
      }

      if (lastPart) {
        let newText = lastPart.text
        const measureText = (t: string) => measurePartWithSpacing({ text: t, style: styleForEllipsis })
        while (newText.length > 0 && (baseWidthWithoutLast + measureText(newText) + ellipsisWidth) > availableWidth) {
          newText = newText.slice(0, -1)
        }
        lastPart.text = newText
        lastPart.width = measureText(newText)
        lastLine.parts[lastLine.parts.length - 1] = lastPart
      }

      lastLine.parts.push({
        text: ellipsis,
        width: ellipsisWidth,
        style: styleForEllipsis
      })
      lastLine.width = baseWidthWithoutLast + (lastPart ? lastPart.width : 0) + ellipsisWidth
      ellipsisAdded = true
    }

    this.linesHeight = this.textLines.reduce((size, line) => size + line.totalHeight, 0)
    this.linesWidth = Math.max(...this.textLines.map((line) => line.width, 0))
    // console.log('[MultiStyledText] layout summary', {
    //   lines: this.textLines.length,
    //   linesHeight: this.linesHeight,
    //   availableHeight,
    //   truncated,
    //   ellipsisAdded
    // })
    this.hasOverflowFlag = truncated || ellipsisAdded
  }

  public hasOverflow(): boolean {
    return this.hasOverflowFlag
  }

  public getHeight(): number {
    const isAuto = this.attrs.height === 'auto' || this.attrs.height === undefined
    if (!isAuto) {
      return Number(this.attrs.height)
    }
    return this.linesHeight + this.padding() * 2
  }

  public getWidth(): number {
    const isAuto = this.attrs.width === 'auto' || this.attrs.width === undefined
    if (!isAuto) {
      return Number(this.attrs.width)
    }
    return this.linesWidth + this.padding() * 2
  }

  /**
   * @description This method is called when the shape should render
   * on canvas
   */
  protected _sceneFunc(context: Context & CanvasRenderingContext2D) {
    if (this.text().length === 0) {
      return
    }

    const totalWidth = this.getWidth()
    const totalHeight = this.getHeight()
    const padding = this.padding()

    let alignY = 0
    if (this.verticalAlign() === 'middle') {
      alignY = (totalHeight - this.linesHeight - padding * 2) / 2;
    } else if (this.verticalAlign() === 'bottom') {
      alignY = totalHeight - this.linesHeight - padding * 2;
    }

    context.setAttr('textBaseline', 'top')
    context.setAttr('textAlign', 'left')

    // background fill for debug
    if (this.backgroundFill()) {
      context.save()
      context.beginPath()
      context.rect(0, 0, totalWidth, totalHeight)
      context.setAttr('fillStyle', this.backgroundFill())
      context.fill()
      context.restore()
    }
    // debug bounds stroke (computed text area)
    if (this.debugBounds()) {
      context.save()
      context.beginPath()
      context.rect(padding, alignY + padding, this.linesWidth, this.linesHeight)
      context.setAttr('strokeStyle', '#007bff')
      context.setAttr('lineWidth', 1)
      context.stroke()
      context.restore()
    }

    // visual overflow indicator (outline) if enabled
    if (this.overflowIndicator() && this.hasOverflowFlag) {
      context.save()
      context.beginPath()
      context.rect(0, 0, totalWidth, totalHeight)
      context.setAttr('strokeStyle', this.overflowStroke())
      context.setAttr('lineWidth', this.overflowStrokeWidth())
      context.stroke()
      context.restore()
    }

    context.translate(padding, alignY + padding)

    let y = 0
    let lineIndex = 0
    for (const line of this.textLines) {
      const isLastLine = lineIndex === this.textLines.length - 1
      let lineX = 0
      let lineY = 0
      context.save()

      // horizontal alignment
      if (this.align() === 'right') {
        lineX += totalWidth - line.width - padding * 2
      } else if (this.align() === 'center') {
        lineX += (totalWidth - line.width - padding * 2) / 2
      }

      for (const part of line.parts) {

        // style
        if (part.style.textDecoration.includes('underline')) {
          context.save();
          context.beginPath()

          context.moveTo(
            lineX,
            y + lineY + Math.round(part.style.fontSize)
          )
          const spacesNumber = part.text.split(' ').length - 1
          const oneWord = spacesNumber === 0
          const lineWidth =
            this.align() === 'justify' && isLastLine && !oneWord
              ? totalWidth - padding * 2
              : part.width
          context.lineTo(
            lineX + Math.round(lineWidth),
            y + lineY + Math.round(part.style.fontSize)
          )

          // I have no idea what is real ratio
          // just /15 looks good enough
          context.lineWidth = part.style.fontSize / 15
          context.strokeStyle = part.style.fill
          context.stroke()
          context.restore()
        }
        if (part.style.textDecoration.includes('line-through')) {
          context.save()
          context.beginPath()
          context.moveTo(lineX, y + lineY + part.style.fontSize / 2)
          const spacesNumber = part.text.split(' ').length - 1
          const oneWord = spacesNumber === 0
          const lineWidth =
            this.align() === 'justify' && isLastLine && !oneWord
              ? totalWidth - padding * 2
              : part.width
          context.lineTo(
            lineX + Math.round(lineWidth),
            y + lineY + part.style.fontSize / 2
          )
          context.lineWidth = part.style.fontSize / 15
          context.strokeStyle = part.style.fill
          context.stroke()
          context.restore()
        }

        this.fill(part.style.fill)
        this.stroke(part.style.stroke)
        context.setAttr('font', this.formatFont(part))

        // text
        if (this.letterSpacing() !== 0 || this.align() === 'justify') {
          const spacesNumber = part.text.split(' ').length - 1
          var array = Array.from(part.text)
          for (let li = 0; li < array.length; li++) {
            const letter = array[li]
            const isLastLetter = li === array.length - 1
            // skip justify for the last line
            if (letter === ' ' && lineIndex !== this.textLines.length - 1 && this.align() === 'justify') {
              lineX += (totalWidth - padding * 2 - line.width) / spacesNumber;
            }
            this.drawState = {
              x: lineX,
              y: y + lineY,
              text: letter
            }
            context.fillStrokeShape(this)
            const advance = this.measurePart({ ...part, text: letter })
            lineX += advance
            if (!isLastLetter) {
              lineX += this.letterSpacing()
            }
          }
        } else {
          this.drawState = {
            x: lineX,
            y: y + lineY,
            text: part.text
          }
          context.fillStrokeShape(this)
          lineX += part.width
          const isLastPartInLine = line.parts[line.parts.length - 1] === part
          if (!isLastPartInLine) {
            lineX += this.letterSpacing()
          }
        }
      }

      context.restore()
      y += line.totalHeight
      ++lineIndex
    }
  }

  /**
   * @description This method is called by context.fillStrokeShape(this)
   * to fill the shape
   */
  public _fillFunc = (context: Context) => {
    context.fillText(this.drawState.text, this.drawState.x, this.drawState.y)
  }

  /**
   * @description This method is called by context.fillStrokeShape(this)
   * to stroke the shape
   */
  public _strokeFunc = (context: Context) => {
    context.strokeText(this.drawState.text, this.drawState.x, this.drawState.y, undefined)
  }

  /**
   * @description This method should render on canvas a rect with
   * the width and the height of the text shape
   */
  protected _hitFunc(context: Context & CanvasRenderingContext2D) {
    context.beginPath()
    context.rect(0, 0, this.getWidth(), this.getHeight())
    context.closePath()
    context.fillStrokeShape(this)
  }

  // for text we can't disable stroke scaling
  // if we do, the result will be unexpected
  public getStrokeScaleEnabled() {
    return true
  }

  // Debug helper for tests/labs
  public getDebugLines() {
    return this.textLines.map((line) => ({
      width: line.width,
      totalHeight: line.totalHeight,
      parts: line.parts.map((part) => part.text)
    }))
  }
}
_registerNode(MultiStyledText)

/**
 * get/set width of text area, which includes padding.
 * @name Konva.Text#width
 * @method
 * @param {Number} width
 * @returns {Number}
 * @example
 * // get width
 * var width = text.width();
 *
 * // set width
 * text.width(20);
 *
 * // set to auto
 * text.width('auto');
 * text.width() // will return calculated width, and not "auto"
 */
Factory.overWriteSetter(MultiStyledText, 'width', getNumberOrAutoValidator())

/**
 * get/set the height of the text area, which takes into account multi-line text, line heights, and padding.
 * @name Konva.Text#height
 * @method
 * @param {Number} height
 * @returns {Number}
 * @example
 * // get height
 * var height = text.height();
 *
 * // set height
 * text.height(20);
 *
 * // set to auto
 * text.height('auto');
 * text.height() // will return calculated height, and not "auto"
 */
Factory.overWriteSetter(MultiStyledText, 'height', getNumberOrAutoValidator())

/**
 * get/set padding
 * @name Konva.Text#padding
 * @method
 * @param {Number} padding
 * @returns {Number}
 * @example
 * // get padding
 * var padding = text.padding();
 *
 * // set padding to 10 pixels
 * text.padding(10);
 */
Factory.addGetterSetter(MultiStyledText, 'padding', 0, getNumberValidator())

/**
 * get/set horizontal align of text.  Can be 'left', 'center', 'right' or 'justify'
 * @name Konva.Text#align
 * @method
 * @param {String} align
 * @returns {String}
 * @example
 * // get text align
 * var align = text.align();
 *
 * // center text
 * text.align('center');
 *
 * // align text to right
 * text.align('right');
 */
Factory.addGetterSetter(MultiStyledText, 'align', 'left')

/**
 * get/set vertical align of text.  Can be 'top', 'middle', 'bottom'.
 * @name Konva.Text#verticalAlign
 * @method
 * @param {String} verticalAlign
 * @returns {String}
 * @example
 * // get text vertical align
 * var verticalAlign = text.verticalAlign();
 *
 * // center text
 * text.verticalAlign('middle');
 */
Factory.addGetterSetter(MultiStyledText, 'verticalAlign', 'top')

/**
 * get/set line height.  The default is 1.
 * @name Konva.Text#lineHeight
 * @method
 * @param {Number} lineHeight
 * @returns {Number}
 * @example
 * // get line height
 * var lineHeight = text.lineHeight();
 *
 * // set the line height
 * text.lineHeight(2);
 */
Factory.addGetterSetter(MultiStyledText, 'lineHeight', 1, getNumberValidator())

/**
 * get/set wrap.  Can be "word", "char", or "none". Default is "word".
 * In "word" wrapping any word still can be wrapped if it can't be placed in the required width
 * without breaks.
 * @name Konva.Text#wrap
 * @method
 * @param {String} wrap
 * @returns {String}
 * @example
 * // get wrap
 * var wrap = text.wrap();
 *
 * // set wrap
 * text.wrap('word');
 */
Factory.addGetterSetter(MultiStyledText, 'wrap', 'word')

/**
 * get/set ellipsis. Can be true or false. Default is false. If ellipses is true,
 * Konva will add "..." at the end of the text if it doesn't have enough space to write characters.
 * That is possible only when you limit both width and height of the text
 * @name Konva.Text#ellipsis
 * @method
 * @param {Boolean} ellipsis
 * @returns {Boolean}
 * @example
 * // get ellipsis param, returns true or false
 * var ellipsis = text.ellipsis();
 *
 * // set ellipsis
 * text.ellipsis(true);
 */
Factory.addGetterSetter(MultiStyledText, 'ellipsis', false, getBooleanValidator())

/**
 * set letter spacing property. Default value is 0.
 * @name Konva.Text#letterSpacing
 * @method
 * @param {Number} letterSpacing
 */
Factory.addGetterSetter(MultiStyledText, 'letterSpacing', 0, getNumberValidator())

// overflow visual indicator
Factory.addGetterSetter(MultiStyledText, 'overflowIndicator', false, getBooleanValidator())
Factory.addGetterSetter(MultiStyledText, 'overflowStroke', '#ff0000', getStringValidator())
Factory.addGetterSetter(MultiStyledText, 'overflowStrokeWidth', 1, getNumberValidator())
Factory.addGetterSetter(MultiStyledText, 'backgroundFill')
Factory.addGetterSetter(MultiStyledText, 'debugBounds', false, getBooleanValidator())

/**
 * get/set text
 * @name Konva.Text#text
 * @method
 * @param {String} text
 * @returns {String}
 * @example
 * // get text
 * var text = text.text();
 *
 * // set text
 * text.text('Hello world!');
 */
Factory.addGetterSetter(MultiStyledText, 'text', '', getStringValidator())

/**
 * get/set textStyles
 * @name Konva.Text#textStyles
 * @method
 * @param {TextStyle[]} textStyles
 * @returns {String}
 * @example
 * // set styles
 * text.textStyles([{ start: 0, fontFamily: 'Roboto' }]);
 */
Factory.addGetterSetter(MultiStyledText, 'textStyles')
