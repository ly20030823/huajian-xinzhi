import type { Translation } from "@mdxeditor/editor";

const zhCN: Record<string, string> = {
  "toolbar.undo": "撤销 {{shortcut}}",
  "toolbar.redo": "重做 {{shortcut}}",
  "toolbar.blockTypes.paragraph": "正文",
  "toolbar.blockTypes.quote": "引用",
  "toolbar.blockTypes.heading": "{{level}} 级标题",
  "toolbar.blockTypeSelect.selectBlockTypeTooltip": "选择段落类型",
  "toolbar.blockTypeSelect.placeholder": "段落类型",
  "toolbar.bold": "加粗",
  "toolbar.removeBold": "取消加粗",
  "toolbar.italic": "斜体",
  "toolbar.removeItalic": "取消斜体",
  "toolbar.underline": "下划线",
  "toolbar.removeUnderline": "取消下划线",
  "toolbar.strikethrough": "删除线",
  "toolbar.removeStrikethrough": "取消删除线",
  "toolbar.subscript": "下标",
  "toolbar.removeSubscript": "取消下标",
  "toolbar.superscript": "上标",
  "toolbar.removeSuperscript": "取消上标",
  "toolbar.inlineCode": "行内代码",
  "toolbar.removeInlineCode": "取消行内代码",
  "toolbar.link": "插入链接",
  "toolbar.image": "插入图片",
  "toolbar.table": "插入表格",
  "toolbar.bulletedList": "无序列表",
  "toolbar.numberedList": "有序列表",
  "toolbar.checkList": "任务列表",
  "toolbar.thematicBreak": "插入分隔线",
  "toolbar.codeBlock": "插入代码块",
  "toolbar.toggleGroup": "格式选项",
  "dialog.close": "关闭窗口",
  "dialogControls.save": "插入",
  "dialogControls.cancel": "取消",
  "uploadImage.dialogTitle": "插入图片",
  "uploadImage.uploadInstructions": "从电脑选择图片（也可将图片拖入正文，或直接按 Ctrl+V 粘贴）：",
  "uploadImage.addViaUrlInstructions": "或者使用图片网址：",
  "uploadImage.addViaUrlInstructionsNoUpload": "使用图片网址：",
  "uploadImage.autoCompletePlaceholder": "粘贴图片网址",
  "uploadImage.alt": "图片说明（可选）：",
  "uploadImage.title": "悬停文字（可选）：",
  "uploadImage.width": "宽度：",
  "uploadImage.height": "高度：",
  "createLink.urlPlaceholder": "粘贴或输入网址",
  "createLink.saveTooltip": "确认链接",
  "createLink.cancelTooltip": "取消修改",
  "imageEditor.deleteImage": "删除图片",
  "imageEditor.editImage": "编辑图片",
  "table.alignLeft": "左对齐",
  "table.alignCenter": "居中对齐",
  "table.alignRight": "右对齐",
  "table.textAlignment": "文字对齐",
  "table.columnMenu": "列选项",
  "table.rowMenu": "行选项",
  "table.deleteColumn": "删除这一列",
  "table.deleteRow": "删除这一行",
  "table.deleteTable": "删除表格",
  "table.insertColumnLeft": "在左侧插入一列",
  "table.insertColumnRight": "在右侧插入一列",
  "table.insertRowAbove": "在上方插入一行",
  "table.insertRowBelow": "在下方插入一行",
  "codeBlock.language": "代码语言",
  "codeBlock.selectLanguage": "选择代码语言",
  "codeblock.delete": "删除代码块",
};

const zhHK: Record<string, string> = {
  ...zhCN,
  "toolbar.undo": "還原 {{shortcut}}",
  "toolbar.redo": "重做 {{shortcut}}",
  "toolbar.blockTypes.paragraph": "正文",
  "toolbar.blockTypes.quote": "引用",
  "toolbar.blockTypes.heading": "{{level}} 級標題",
  "toolbar.blockTypeSelect.selectBlockTypeTooltip": "選擇段落類型",
  "toolbar.image": "插入圖片",
  "uploadImage.dialogTitle": "插入圖片",
  "uploadImage.uploadInstructions": "從電腦選擇圖片（也可將圖片拖入正文，或直接按 Ctrl+V 貼上）：",
  "uploadImage.addViaUrlInstructions": "或者使用圖片網址：",
  "uploadImage.addViaUrlInstructionsNoUpload": "使用圖片網址：",
  "uploadImage.autoCompletePlaceholder": "貼上圖片網址",
  "uploadImage.alt": "圖片說明（可選）：",
  "uploadImage.title": "懸停文字（可選）：",
  "dialogControls.save": "插入",
};

function interpolate(template: string, interpolations?: Record<string, unknown>) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = interpolations?.[key];
    return value === undefined ? match : String(value);
  });
}

export function createEditorTranslation(language: string): Translation {
  const translations = language.toLowerCase().startsWith("zh-hk") ? zhHK : zhCN;

  return (key, defaultValue, interpolations) => {
    const template = language.toLowerCase().startsWith("en")
      ? defaultValue
      : (translations[key] ?? defaultValue);
    return interpolate(template, interpolations);
  };
}
