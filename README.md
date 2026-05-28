# 莫罗女装 H5

一个纯静态女装展示挑选页面，支持上传照片、本地预览、顾客选择和复制清单。

## 本地预览

双击 `start-moluo-site.command`，手机和电脑连接同一个 Wi-Fi 后，用终端里显示的手机网址访问。

## 部署到 Vercel

推荐方式：

1. 打开 https://vercel.com/new
2. 选择 `Browse All Templates` 或直接导入本项目所在 GitHub 仓库
3. Framework Preset 选择 `Other`
4. Build Command 留空
5. Output Directory 留空或填写 `.`
6. 点击 Deploy

命令行方式：

```bash
npx vercel --prod
```

## 部署到 GitHub Pages

1. 在 GitHub 新建一个公开仓库，比如 `moluo`
2. 上传本目录的全部文件
3. 打开仓库 `Settings -> Pages`
4. Source 选择 `Deploy from a branch`
5. Branch 选择 `main`，目录选择 `/root`
6. 保存后等待页面生成

生成的网址通常是：

```text
https://你的用户名.github.io/moluo/
```
