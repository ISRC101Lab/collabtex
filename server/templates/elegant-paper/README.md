# Elegant Paper Template

A clean and professional LaTeX template for academic papers using the ACM format.

## Features

- **Clean Layout**: Simplified structure without unnecessary complexity
- **Professional Typography**: Uses microtype for better text rendering
- **Two-Column Format**: Standard ACM conference paper layout
- **Anonymous Submission**: Configured for double-blind review
- **Easy to Use**: Minimal configuration required

## Structure

- `main.tex` - Main document file
- `references.bib` - Bibliography file
- `figures/` - Place your figures here

## Usage

1. Edit the title, authors, and abstract in `main.tex`
2. Write your content in the main sections
3. Add your references to `references.bib`
4. Place figures in the `figures/` directory
5. Compile with pdflatex + bibtex

## Customization

### Adding Sections

Simply add new `\section{}` commands in the main document.

### Adding Figures

```latex
\begin{figure}[t]
  \centering
  \includegraphics[width=\columnwidth]{figures/your-figure.pdf}
  \caption{Your caption here}
  \label{fig:yourlabel}
\end{figure}
```

### Adding Tables

```latex
\begin{table}[t]
  \caption{Your table caption}
  \label{tab:yourlabel}
  \centering
  \begin{tabular}{lcc}
    \toprule
    Header 1 & Header 2 & Header 3 \\
    \midrule
    Data 1 & Data 2 & Data 3 \\
    \bottomrule
  \end{tabular}
\end{table}
```

## Tips

- Keep your abstract concise (150-250 words)
- Use `\cite{}` for citations
- Use `\ref{}` for cross-references
- Place figures and tables at the top of columns with `[t]`
